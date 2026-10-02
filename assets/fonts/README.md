# Documentation symbols

`DocumentationSymbols.ttf` is a 7.9 KB static subset of Google's monochrome
[Noto Emoji](https://github.com/google/fonts/tree/main/ofl/notoemoji), containing
only U+23F8 (pause), U+2705 (check mark), U+274C (cross mark), U+1F4CA (chart),
U+1F4C1 (folder), U+2764 (heart), U+1F440, U+1F44D and U+1F44E (eyes, thumbs up
and thumbs down) and U+1F534, U+1F7E1 and U+1F7E3 (red, yellow and purple
circles), merged with U+23F5 (right-pointing triangle) from
[Noto Sans Symbols 2](https://github.com/google/fonts/tree/main/ofl/notosanssymbols2).
The LaTeX template selects it explicitly for those characters; other glyphs use
the configured text, code or CJK fonts.

The source `NotoEmoji[wght].ttf` was downloaded on 2026-08-28 from the Google
Fonts repository, instantiated at weight 400 and subset with FontTools. Its
modified family name is `DocumentationSymbols`. The original SIL Open Font
License and copyright notice are in [OFL.txt](OFL.txt).

`NotoSansSymbols2-Regular.ttf` was downloaded on 2026-10-02 from the same
repository; its U+23F5 subset was scaled from 1000 to 2048 units per em and
merged into the Noto Emoji subset with FontTools. Both fonts are Copyright 2013
Google LLC under the SIL Open Font License.

Source SHA-256:

- `NotoEmoji[wght].ttf`: `de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551`
- `NotoSansSymbols2-Regular.ttf`: `7d5fb73b7ca67a6798101741f5d280a3d016a56a197afcd4199dbb57b4b82a21`

Keep these characters in the fixed PDF fixture when changing fonts. Glyph
coverage is checked from the generated PDF, not just the source font's name.
