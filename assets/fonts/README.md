# Documentation symbols

`DocumentationSymbols.ttf` is a 1.7 KB static subset of Google's monochrome
[Noto Emoji](https://github.com/google/fonts/tree/main/ofl/notoemoji), containing
only U+23F8 (pause), U+2705 (check mark), U+274C (cross mark), U+1F4CA (chart)
and U+1F4C1 (folder). The LaTeX template
selects it explicitly for those characters; other glyphs use the configured
text, code or CJK fonts.

The source `NotoEmoji[wght].ttf` was downloaded on 2026-08-28 from the Google
Fonts repository, instantiated at weight 400 and subset with FontTools. Its
modified family name is `DocumentationSymbols`. The original SIL Open Font
License and copyright notice are in [OFL.txt](OFL.txt).

Source SHA-256: `de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551`.

Keep these characters in the fixed PDF fixture when changing fonts. Glyph
coverage is checked from the generated PDF, not just the source font's name.
