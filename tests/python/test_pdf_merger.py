import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pymupdf


class PdfMergerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pdf_dir = self.root / "pdfs"
        self.source = self.pdf_dir / "docs"
        self.source.mkdir(parents=True)
        self.metadata = self.pdf_dir / "metadata"
        self.metadata.mkdir()
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps({"rootURL": "https://example.com/docs", "pdfDir": str(self.pdf_dir)}))
        self.titles = {"0": "Overview", "2": "Guide", "10": "Reference"}
        (self.metadata / "articleTitles.json").write_text(json.dumps(self.titles))
        (self.metadata / "sectionStructure.json").write_text(json.dumps({"sections": [{
            "title": "Documentation", "pages": [{"index": index} for index in self.titles],
        }]}))
        for index, title in self.titles.items():
            with pymupdf.open() as doc:
                doc.new_page().insert_text((72, 72), title)
                doc.save(self.source / f"{int(index):03d}-article.pdf")

    def run_merge(self):
        return subprocess.run([
            sys.executable, str(Path(__file__).resolve().parents[2] / "src/python/pdf_merger.py"),
            "--config", str(self.config),
        ], capture_output=True, text=True, timeout=30)

    def test_real_cli_merges_numeric_order_with_current_metadata(self):
        result = self.run_merge()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout.splitlines()[-1])
        self.assertEqual((report["filesProcessed"], report["totalPages"]), (3, 3))
        with pymupdf.open(report["mergedFiles"][0]) as doc:
            self.assertEqual([page.get_text().strip() for page in doc], list(self.titles.values()))
            self.assertEqual(doc.get_toc(), [[1, "Documentation", 1], [2, "Overview", 1],
                                             [2, "Guide", 2], [2, "Reference", 3]])

    def test_missing_metadata_does_not_use_legacy_root_files(self):
        (self.metadata / "articleTitles.json").rename(self.pdf_dir / "articleTitles.json")
        self.assertNotEqual(self.run_merge().returncode, 0)

    def test_missing_title_does_not_use_filename(self):
        (self.metadata / "articleTitles.json").write_text(json.dumps({"0": "Overview"}))
        self.assertNotEqual(self.run_merge().returncode, 0)

    def test_invalid_section_metadata_does_not_flatten_toc(self):
        (self.metadata / "sectionStructure.json").write_text("{broken")
        self.assertNotEqual(self.run_merge().returncode, 0)

    def test_missing_section_article_is_fatal(self):
        (self.metadata / "sectionStructure.json").write_text(json.dumps({"sections": [{
            "title": "Documentation", "pages": [{"index": "0"}],
        }]}))
        self.assertNotEqual(self.run_merge().returncode, 0)

    def test_broken_input_cannot_publish_partial_pdf(self):
        (self.source / "002-article.pdf").write_bytes(b"broken")
        result = self.run_merge()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(list((self.pdf_dir / "finalPdf").glob("*.pdf")))


if __name__ == "__main__":
    unittest.main()
