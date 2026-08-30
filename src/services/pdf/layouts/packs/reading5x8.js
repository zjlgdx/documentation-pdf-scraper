export const reading5x8 = {
  id: 'reading-5x8',
  version: '1.0.0',
  renderer: 'pandoc-xelatex',
  page: {
    width: '5in',
    height: '8in',
    margins: { top: '0.65in', right: '0.5in', bottom: '0.65in', left: '0.5in' },
    duplex: false,
  },
  typography: {
    bodyFont: 'Noto Serif CJK SC',
    headingFont: 'Noto Sans CJK SC',
    monoFont: 'DejaVu Sans Mono',
    fontSizePt: 10.5,
    lineHeight: 1.5,
    headingSizesPt: { h1: 17, h2: 14, h3: 12 },
    runningHeaderSizePt: 8.5,
    punctuationStyle: 'kaiming',
  },
  paragraphs: { firstLineIndentEm: 0, spacingEm: 0.6 },
  pagination: {
    widowPenalty: 8000,
    orphanPenalty: 8000,
    displayWidowPenalty: 8000,
    raggedBottom: true,
    headingKeepLines: 3,
  },
  furniture: {
    runningHeader: 'section-and-page',
    firstContentPage: 'footer-only',
    pageNumbering: 'roman-toc-arabic-body',
    maxMarkEm: 28,
    headHeight: '10pt',
    headSep: '8pt',
    footSkip: '24pt',
    openingLines: 2,
  },
  content: {
    codeFontSizePt: 8.5,
    wrapCode: true,
    maxImageWidth: 1,
    maxTableWidth: 1,
  },
  verification: {
    requiredFonts: [
      { name: 'Noto Serif CJK SC', embeddedNames: ['NotoSerifCJKsc'] },
      {
        name: 'Noto Sans CJK SC',
        // The macOS/Linux Noto CJK TTC selected by this exact family name can
        // expose its shared Japanese PostScript face name in the embedded PDF.
        embeddedNames: ['NotoSansCJKsc', 'NotoSansCJKjp'],
      },
      { name: 'DejaVu Sans Mono', embeddedNames: ['DejaVuSansMono'] },
    ],
    headerZone: { top: '0.2in', bottom: '0.58in', maxFontSizePt: 9 },
    footerZone: { top: '7.4in', bottom: '7.9in', maxFontSizePt: 9 },
    previewKinds: ['toc', 'article-start', 'image', 'code', 'table', 'annotation', 'last'],
  },
};
