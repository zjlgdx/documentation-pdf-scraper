# Documentation PDF Scraper

A professional web scraper and PDF generator that converts documentation websites into high-quality PDF files. It supports both **live website scraping** and **local Markdown-to-PDF conversion**, featuring modular architecture and device-optimized output (Kindle/Tablets).

## Features

- **Dual Modes**:
    - 🕷️ **Web Scraper**: Intelligent crawling of documentation sites using Puppeteer.
    - 📄 **Batch Markdown**: Direct high-fidelity PDF generation from local Markdown files.
- **Device Optimization**: Specialized layout presets for Kindle (7", Paperwhite, Oasis, Scribe).
- **Multi-Target Support**: Built-in configs for common docs (OpenAI, Claude, Anthropic) + custom targets.
- **Smart Formatting**:
    - Preserves original styling while ensuring readability.
    - Handles wide tables, code blocks, and complex layouts.
    - **LaTeX-enhanced** PDF generation (via Pandoc) for professional typography.
- **Modular Architecture**: Dependency injection, parallel processing, and robust error handling.

## Quick Start

### Environment choices

- **Windows host (recommended):** use Docker Desktop + the repo's `devcontainer`. This keeps the runtime in a Linux container even when the host is Windows. The workspace is mounted at `/workspace`, while `node_modules` and `.venv` live on named volumes to avoid slow NTFS bind-mount writes.
- **macOS (recommended):** develop directly on the host. Docker is optional on macOS and mainly useful when reproducing a container-specific issue.

### Windows host with Docker Desktop / devcontainer

1. Install Docker Desktop.
2. Open the repository in VS Code and run **Dev Containers: Reopen in Container**.
3. Wait for the container's `postCreateCommand` to finish `make install`.
4. Run the normal workflow inside the container:

```bash
npm run docs:openai
make clean && make run
```

### macOS host installation

```bash
# Install all dependencies (Node.js + Python via uv)
make install
```

### macOS host prerequisites
- Node.js >= 18.18.0
- Python >= 3.10 (for PDF processing)
- uv (Python package/environment manager)
- Current Pandoc
- Poppler (`brew install poppler`) for PDF verification previews
- A LaTeX engine that provides `xelatex`
- DejaVu fonts (`brew install --cask font-dejavu`) and Noto Sans CJK SC
  for code and Chinese text. A small licensed symbol font is bundled under `assets/fonts`.
- Cairo (`brew install cairo`) for SVG diagrams in generated PDFs

## Usage

### Mode 1: Web Scraping

Scrape a documentation website and convert it to PDF.

```bash
# 1. Select a target (e.g., OpenAI docs)
npm run docs:openai

# 2. Run the scraper
make clean && make run
```

### Source and rendering modes

`make run` always collects the selected target first. `markdownPdf.batchMode=true`
means one final Pandoc PDF is built after collection; it does not skip scraping.

- `markdownSource.enabled=true`: fetch the official source directly. Explicit URL
  lists need no Chromium; navigation discovery may still use a browser.
- `markdownSource.enabled=false`: extract content from the browser DOM.
- `markdownSource.format`: `markdown` or `mdx`, selected to match the source grammar.
- `markdown.enabled=true` and `markdownPdf.enabled=true`: use Pandoc/XeLaTeX.
  With both disabled, use Puppeteer printing and Python merging.

Source, parser, translation, image conversion and renderer errors are reported;
the workflow never switches to another source or PDF engine. A failed page stops
final PDF generation after configured retries. With translation disabled, only
one Markdown file is written; translated output is selected only when enabled.

### PDF verification

Every `make run` checks the final PDF and writes `qa/<PDF name>/report.json` plus
Poppler page previews beside the PDF. Missing titles/glyphs, overflow, invalid
bookmarks and mismatched printed TOC numbers fail the command. Review the PNGs
for spacing, hierarchy, overlap and legibility; automated checks cannot certify
visual quality.

```bash
make pdf-smoke                         # Fixed local layout fixture, no website
make verify-pdf PDF=path/to/file.pdf   # Recheck using the current profile
```

The CI `PDF Layout Smoke` job generates the fixture and uploads its PDF, report
and previews. The repository skill at
[documentation-pdf-workflow](.agents/skills/documentation-pdf-workflow/SKILL.md)
describes the evidence and review order for agent-assisted work.

### device Optimization (Kindle)

Generate PDFs optimized for specific e-readers:

```bash
make kindle7           # Kindle 7-inch
make kindle-paperwhite # Kindle Paperwhite
make kindle-oasis      # Kindle Oasis
make kindle-scribe     # Kindle Scribe
```

## Configuration

### Base Configuration (`config.json`)

The core configuration file. `docTarget` determines which target-specific config is merged in.

```json
{
  "docTarget": "claude-code-curated",
  "pdfDir": "pdfs",
  "concurrency": 5,
  "markdown": { "enabled": true, "outputDir": "markdown" },
  "markdownPdf": { "enabled": true, "batchMode": true }
}
```

### Documentation Targets (`doc-targets/*.json`)

Target-specific configurations (URLs, selectors, etc.) are stored in `doc-targets/`.

**Example (official MDX source with an explicit selection):**
```json
{
  "rootURL": "https://code.claude.com/docs/en/overview",
  "baseUrl": "https://code.claude.com/docs/en/",
  "allowedDomains": ["code.claude.com"],
  "contentSelector": "#content-area",
  "navLinksSelector": "nav a",
  "targetUrls": ["https://code.claude.com/docs/en/overview"],
  "markdownSource": { "enabled": true, "format": "mdx", "urlSuffix": ".md" }
}
```

**Manage Targets via CLI:**
```bash
npm run docs:openai      # Switch to OpenAI config
npm run docs:claude      # Switch to Claude Code config
npm run docs:claude-curated # Switch to 16 curated Claude Code pages in four sections
npm run docs:current     # Show current target info
npm run docs:list        # List all available targets
```

For a focused Claude Code handbook with a hierarchical table of contents:

```bash
make docs-claude-curated
make clean && make run
```

Curated targets use `targetSections` (ordered `title`, `entryUrl`, and `urls` groups)
to keep the document structure reproducible without manual metadata edits.

## Architecture

The project uses a **Dependency Injection (DI)** container for modularity:

- **Core**: `Application`, shared `ProcessRunner`
- **Services**:
    - `Scraper`: explicit Markdown or DOM acquisition, ordering and resume state.
    - `PandocPdfService`: rendering and batch assembly; content normalization and LaTeX typography live in `src/services/pdf/`.
    - `PythonMergeService`: Merges multiple PDFs using PyMuPDF.

## Development

```bash
# Run tests
make test

# Lint code
make lint

# Check Python environment
make python-info
```

## License

ISC License
