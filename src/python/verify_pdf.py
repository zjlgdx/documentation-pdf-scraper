"""Check generated documentation PDFs; rendered previews still need human review."""
import argparse
import json
from pathlib import Path
import re
import subprocess

import pymupdf


def compact(text):
    return re.sub(r"\s+", "", text.translate(str.maketrans("‘’“”", "''\"\"")))


def destination_key(link):
    point = link.get("to", (0, 0))
    return (link.get("page", -1), link.get("nameddest") or tuple(round(value, 2) for value in point))


def inspect_pdf(pdf_path, expectations=None):
    expectations = expectations or {}
    issues = []
    with pymupdf.open(pdf_path) as doc:
        if doc.needs_pass or not doc.page_count:
            raise ValueError("PDF must be readable and contain pages")
        detailed_outline = doc.get_toc(simple=False)
        outline = [entry[:3] for entry in detailed_outline]
        toc_pages = [i for i, page in enumerate(doc)
                     if re.fullmatch(r"[ivxlcdm]+", page.get_label())]
        texts = []
        preview_pages = {0, len(doc) - 1, *toc_pages}
        toc_links = {}
        toc_annotations = 0
        for index, page in enumerate(doc):
            text = page.get_text()
            texts.append(text)
            words = page.get_text("words", clip=pymupdf.INFINITE_RECT())
            if "\ufffd" in text:
                issues.append({"kind": "replacement_character", "page": index + 1})
            for span in page.get_texttrace():
                if any(char[1] == 0 and not chr(char[0]).isspace() for char in span["chars"]):
                    issues.append({"kind": "missing_glyph", "page": index + 1, "font": span["font"],
                                   "context": "".join(chr(char[0]) for char in span["chars"])[:160]})
                    break
            images = page.get_image_info()
            if images:
                preview_pages.add(index)
            if not text.strip() and not images:
                issues.append({"kind": "empty_page", "page": index + 1})
            boxes = [(word[:4], word[4]) for word in words]
            boxes += [(image["bbox"], "image") for image in images]
            for coords, value in boxes:
                box = pymupdf.Rect(coords) * page.rotation_matrix
                left = expectations.get("marginLeftPt", 0)
                right = page.rect.width - expectations.get("marginRightPt", 0)
                if box.x0 < left - 2 or box.x1 > right + 2 or box.y0 < -2 or box.y1 > page.rect.height + 2:
                    issues.append({"kind": "overflow", "page": index + 1,
                                   "text": value, "box": list(box)})
            for link in page.get_links():
                if link["kind"] not in (pymupdf.LINK_GOTO, pymupdf.LINK_NAMED):
                    continue
                target = link.get("page", -1)
                if not 0 <= target < len(doc):
                    issues.append({"kind": "invalid_link", "page": index + 1})
                    continue
                if index in toc_pages:
                    toc_annotations += 1
                    key = destination_key(link)
                    entry = toc_links.setdefault(key, {"page": index, "target": target, "boxes": []})
                    entry["boxes"].append(link["from"])

        for entry in toc_links.values():
            page = doc[entry["page"]]
            words = page.get_text("words")
            right_numbers = [word for word in words if re.fullmatch(r"\d+", word[4])
                             and word[0] > page.rect.width * 0.7]
            right_edge = max((word[2] for word in right_numbers), default=page.rect.width)
            top = min(box.y0 for box in entry["boxes"])
            bottom = max(box.y1 for box in entry["boxes"])
            numbers = [word[4] for word in right_numbers if word[2] >= right_edge - 2
                       and top - 1 <= (word[1] + word[3]) / 2 <= bottom + 1]
            expected = doc[entry["target"]].get_label()
            if numbers != [expected]:
                issues.append({"kind": "toc_page_number", "page": entry["page"] + 1,
                               "printed": numbers, "expected": expected})

        for position, (level, title, page_number) in enumerate(outline):
            # Merged PDFs can have logical section bookmarks without a printed
            # section heading. Printed Pandoc TOCs must match every heading.
            has_children = position + 1 < len(outline) and outline[position + 1][0] > level
            if not 1 <= page_number <= len(doc):
                issues.append({"kind": "invalid_bookmark", "title": title})
            elif (expectations.get("requireToc") or not has_children) and compact(title) not in compact(texts[page_number - 1]):
                issues.append({"kind": "bookmark_title", "title": title, "page": page_number})
            if level <= 2 and page_number > 0:
                preview_pages.add(page_number - 1)
        full_text = compact("\n".join(texts))
        found_titles = [title for title in expectations.get("candidateTitles", [])
                        if compact(title) in full_text]
        for title in expectations.get("titles", []):
            if compact(title) not in full_text:
                issues.append({"kind": "missing_title", "title": title})
        for title in expectations.get("groups", []):
            if title not in [entry[1] for entry in outline if entry[0] == 1]:
                issues.append({"kind": "missing_group", "title": title})
        if expectations.get("requireToc"):
            if not outline or len(toc_pages) < expectations.get("minTocPages", 1):
                issues.append({"kind": "missing_toc"})
            if list(toc_links) != [destination_key(entry[3]) for entry in detailed_outline]:
                issues.append({"kind": "toc_targets", "links": len(toc_links), "bookmarks": len(outline)})
        if expectations.get("requireImages") and not any(page.get_image_info() for page in doc):
            issues.append({"kind": "missing_image"})
        preview_pages.update(issue["page"] - 1 for issue in issues if "page" in issue)
        return {
            "pdf": str(Path(pdf_path).resolve()), "pages": len(doc),
            "outlineEntries": len(outline), "tocPages": [i + 1 for i in toc_pages],
            "tocLinks": len(toc_links), "tocAnnotations": toc_annotations, "issues": issues, "passed": not issues,
            "previewPages": [i + 1 for i in sorted(preview_pages) if 0 <= i < len(doc)],
            "visualReview": "required",
            "foundTitles": found_titles,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--report-dir", type=Path, required=True)
    parser.add_argument("--expectations", type=Path)
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    expectations = json.loads(args.expectations.read_text()) if args.expectations else {}
    args.report_dir.mkdir(parents=True, exist_ok=True)
    report = inspect_pdf(args.pdf, expectations)
    report_path = args.report_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if args.render:
        for page in report["previewPages"]:
            subprocess.run([
                "pdftoppm", "-f", str(page), "-l", str(page), "-singlefile", "-r", "110", "-png",
                str(args.pdf), str(args.report_dir / f"page-{page:03d}"),
            ], check=True, timeout=60, capture_output=True)
    print(json.dumps({"passed": report["passed"], "pages": report["pages"],
                      "foundTitles": report["foundTitles"],
                      "issues": len(report["issues"]), "report": str(report_path)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
