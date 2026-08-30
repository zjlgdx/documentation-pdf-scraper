import { ValidationError } from '../../../utils/errors.js';

export const LAYOUT_CONTROLLED_PATHS = [
  'pdf.enableCodeWrap',
  'pdf.fontSize',
  'pdf.fontFamily',
  'pdf.codeFont',
  'pdf.codeFontSize',
  'pdf.lineHeight',
  'pdf.maxCodeLineLength',
  'pdf.kindleOptimized',
  'pdf.deviceProfile',
  'pdf.format',
  'pdf.pageFormat',
  'pdf.margin',
  'pdf.displayHeaderFooter',
  'markdownPdf.cjkMainFont',
  'markdownPdf.pdfOptions.format',
  'markdownPdf.pdfOptions.margin',
];

function hasOwnPath(object, path) {
  let current = object;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

export function assertLayoutLayerCompatibility(layers) {
  let selectedIndex = -1;
  for (let index = 0; index < layers.length; index++) {
    if (hasOwnPath(layers[index].config, 'pdf.layoutPreset')) selectedIndex = index;
  }
  if (selectedIndex < 0) return null;

  const selection = layers[selectedIndex];
  const preset = selection.config.pdf.layoutPreset;
  for (let index = selectedIndex; index < layers.length; index++) {
    const layer = layers[index];
    const conflicts = LAYOUT_CONTROLLED_PATHS.filter((field) => hasOwnPath(layer.config, field));
    if (conflicts.length) {
      throw new ValidationError(
        `PDF layout preset "${preset}" conflicts with explicit fields in ${layer.name}: ${conflicts.join(', ')}`,
        { preset, source: layer.name, conflicts }
      );
    }
  }
  return { preset, source: selection.name, sourceIndex: selectedIndex };
}
