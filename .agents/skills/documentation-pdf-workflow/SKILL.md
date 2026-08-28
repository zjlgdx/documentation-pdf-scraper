---
name: documentation-pdf-workflow
description: Diagnose, maintain, and verify this repository's documentation scraping and PDF generation workflow, including source selection, Markdown/MDX normalization, and TOC or layout acceptance. Use for scraper changes and documentation PDF runs in this project.
---

# Documentation PDF workflow

Read the repository `AGENTS.md` first; it owns configuration, coding and safety
rules. Keep diagnosis read-only when requested. Do not interpret permission to
generate or repair PDFs as permission to commit, push or publish.

## Choose the actual input and output contracts

- Inspect the current target and profile rather than assuming Claude Code or A4.
  Prefer a one-run `DOC_TARGET=<target>` override when a persistent switch was not requested.
- Native sources use `markdownSource.enabled=true`; select `format=markdown` or
  `format=mdx` from the actual source syntax. A `.md` suffix alone does not prove
  that the response contains plain Markdown. Invalid responses and parse errors
  must fail; do not add DOM, regex, renderer or image-link fallbacks.
- For curated collections, use ordered `targetSections`. Native sources plus
  explicit URLs need no browser; navigation discovery can still require one.
- `markdownPdf.batchMode=true` still scrapes first, then creates one PDF from the
  collected Markdown. It is not a switch for skipping acquisition.

## Repair the earliest broken representation

Inspect `pdfs/markdown` before changing typography. Fix extraction or
`src/services/pdf/markdownNormalizer.js` when the Markdown is already wrong.
Fix `pandocTemplate.js` for typography and `pandocPdfService.js` for renderer or
assembly behavior. Do not hand-edit generated Markdown or metadata to disguise
a project defect. Preserve title order, semantic code indentation and authored
image dimensions.

For missing glyphs, inspect the reported font and text context before editing
content. Verify the regular and bold code faces, CJK text and symbols inside
verbatim blocks. Preserve source Unicode; fix explicit font coverage rather
than replacing meaningful characters or accepting font substitution.

## Verify in order

Follow the cleanup requirement in `AGENTS.md`; preserve any needed prior output
under `output/` before an authorized `make clean`.

1. Run `make test && make lint` for code changes. Tests must import the real
   implementation, not contain a second implementation of the service.
2. Run `make pdf-smoke` for content, rendering or verification changes. It uses
   fixed local input and writes the PDF, report and previews to `output/pdf-smoke/`.
3. When live acquisition is in scope, run `DOC_TARGET=<target> make run` with the
   requested profile. This verifies the final PDF and writes `qa/<PDF stem>/`
   beside it. Keep failed runs' reports while investigating.
4. Inspect the rendered PNGs: every TOC page, article starts, long code and wide
   tables, image pages, and the final page. Check indentation, heading hierarchy,
   page-number alignment, clipping and image/paragraph spacing. For deeper
   inspection, use the available PDF skill or Poppler to render more pages.

`make verify-pdf PDF=<path>` rechecks a PDF using the current profile. Use the
same profile that generated it; margin checks are profile-dependent.

## Report evidence accurately

Distinguish unit tests, the fixed PDF fixture, live site acquisition, automated
PDF checks and actual visual review. `report.json` deliberately leaves
`visualReview` as `required`; zero automatic issues is not proof that a person
reviewed the pages. State which previews were inspected and any remaining gaps.
