import { lengthToPoints } from './units.js';

export function getLayoutVerificationExpectations(layout) {
  if (!layout) return {};
  const { page, verification } = layout;
  return {
    layout: {
      id: layout.id,
      version: layout.version,
      fingerprint: layout.fingerprint,
    },
    pageWidthPt: lengthToPoints(page.width, 'layout page width'),
    pageHeightPt: lengthToPoints(page.height, 'layout page height'),
    marginTopPt: lengthToPoints(page.margins.top, 'layout top margin'),
    marginRightPt: lengthToPoints(page.margins.right, 'layout right margin'),
    marginBottomPt: lengthToPoints(page.margins.bottom, 'layout bottom margin'),
    marginLeftPt: lengthToPoints(page.margins.left, 'layout left margin'),
    headerZoneTopPt: lengthToPoints(verification.headerZone.top, 'layout header top'),
    headerZoneBottomPt: lengthToPoints(verification.headerZone.bottom, 'layout header bottom'),
    headerMaxFontSizePt: verification.headerZone.maxFontSizePt,
    footerZoneTopPt: lengthToPoints(verification.footerZone.top, 'layout footer top'),
    footerZoneBottomPt: lengthToPoints(verification.footerZone.bottom, 'layout footer bottom'),
    footerMaxFontSizePt: verification.footerZone.maxFontSizePt,
    requiredFonts: verification.requiredFonts,
    previewKinds: verification.previewKinds,
  };
}
