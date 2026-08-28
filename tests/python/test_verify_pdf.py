import importlib.util
from pathlib import Path
import tempfile
import unittest

import pymupdf

spec = importlib.util.spec_from_file_location(
    "verify_pdf", Path(__file__).resolve().parents[2] / "src/python/verify_pdf.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class VerifyPdfTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "fixture.pdf"

    def create_pdf(self, printed="1", overflow=False, empty=False):
        with pymupdf.open() as doc:
            doc.new_page(width=300, height=400)
            doc.new_page(width=300, height=400)
            doc[0].insert_text((30, 70), "Contents")
            doc[0].insert_text((30, 100), "Guide")
            doc[0].insert_text((260, 100), printed)
            doc[0].insert_link({"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(30, 86, 280, 103),
                                "page": 1, "to": pymupdf.Point(0, 70)})
            if not empty:
                doc[1].insert_text((30, 70), "Guide")
            if overflow:
                doc[1].insert_text((290, 150), "Long text outside the page")
            doc.set_toc([[1, "Guide", 2, {"kind": pymupdf.LINK_GOTO, "page": 1, "to": pymupdf.Point(0, 70)}]])
            doc.set_page_labels([{"startpage": 0, "style": "r"}, {"startpage": 1, "style": "D"}])
            doc.save(self.path)

    def test_valid_bookmarks_labels_and_titles(self):
        self.create_pdf()
        result = verify.inspect_pdf(self.path, {"requireToc": True, "titles": ["Guide"]})
        self.assertTrue(result["passed"], result["issues"])
        self.assertEqual(result["tocPages"], [1])
        self.assertEqual(result["tocLinks"], 1)
        self.assertEqual(result["visualReview"], "required")

    def test_wrapped_toc_title_can_have_multiple_link_annotations(self):
        self.create_pdf()
        with pymupdf.open(self.path) as doc:
            doc[0].insert_link({"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(30, 76, 100, 86),
                                "page": 1, "to": pymupdf.Point(0, 70)})
            doc.saveIncr()
        result = verify.inspect_pdf(self.path, {"requireToc": True})
        self.assertTrue(result["passed"], result["issues"])
        self.assertEqual(result["tocLinks"], 1)
        self.assertEqual(result["tocAnnotations"], 2)

    def test_printed_page_number_mismatch_is_fatal(self):
        self.create_pdf(printed="9")
        kinds = [issue["kind"] for issue in verify.inspect_pdf(self.path)["issues"]]
        self.assertIn("toc_page_number", kinds)

    def test_text_outside_page_is_detected_even_when_clipped(self):
        self.create_pdf(overflow=True)
        result = verify.inspect_pdf(self.path)
        self.assertIn("overflow", [issue["kind"] for issue in result["issues"]])

    def test_expected_structure_and_images_cannot_disappear(self):
        self.create_pdf()
        result = verify.inspect_pdf(self.path, {
            "titles": ["Missing title"], "groups": ["Missing group"],
            "requireToc": True, "minTocPages": 2, "requireImages": True,
        })
        self.assertEqual({issue["kind"] for issue in result["issues"]},
                         {"missing_title", "missing_group", "missing_toc", "missing_image"})

    def test_empty_body_and_wrong_bookmark_destination_are_detected(self):
        self.create_pdf(empty=True)
        kinds = [issue["kind"] for issue in verify.inspect_pdf(self.path)["issues"]]
        self.assertIn("empty_page", kinds)
        self.assertIn("bookmark_title", kinds)

    def test_corrupt_pdf_is_not_accepted(self):
        self.path.write_text("not a PDF")
        with self.assertRaises(pymupdf.FileDataError):
            verify.inspect_pdf(self.path)


if __name__ == "__main__":
    unittest.main()
