import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '../../utils/errors.js';
import { lengthToPoints } from './layouts/units.js';
import { resolvePdfLayout } from './layouts/layoutRegistry.js';
import { getLayoutVerificationExpectations } from './layouts/layoutVerification.js';

const verifier = fileURLToPath(new URL('../../python/verify_pdf.py', import.meta.url));

function points(value) {
  try {
    return lengthToPoints(value, 'PDF margin');
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`Unsupported PDF margin: ${value}`);
  }
}

/** Run the same verification from the application, smoke fixture and CLI. */
export async function verifyPdf(pdfPath, {
  config, processRunner, expectations = {}, reportDir, layout: providedLayout,
}) {
  const layout = providedLayout === undefined ? resolvePdfLayout(config) : providedLayout;
  const margin = config.pdf?.kindleOptimized
    ? config.pdf.margin : config.markdownPdf?.pdfOptions?.margin;
  const requireToc = config.markdownPdf?.enabled && config.markdownPdf.batchMode
    && config.markdownPdf.toc !== false;
  const checks = {
    requireToc,
    ...expectations,
    ...getLayoutVerificationExpectations(layout),
  };
  if (config.markdownPdf?.enabled && !layout) {
    checks.marginLeftPt = points(typeof margin === 'object' ? margin.left || '1in' : margin || '1in');
    checks.marginRightPt = points(typeof margin === 'object' ? margin.right || '1in' : margin || '1in');
    checks.marginTopPt = points(typeof margin === 'object' ? margin.top || '1in' : margin || '1in');
    checks.marginBottomPt = points(typeof margin === 'object' ? margin.bottom || '1in' : margin || '1in');
    const format = config.pdf?.kindleOptimized ? config.pdf.pageFormat || config.pdf.format
      : config.markdownPdf.pdfOptions?.format;
    const sizes = { A3: [297, 420], A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4],
      Legal: [215.9, 355.6], Tabloid: [279.4, 431.8] };
    if (format) {
      if (!sizes[format]) throw new ValidationError(`Unsupported PDF verification format: ${format}`);
      [checks.pageWidthPt, checks.pageHeightPt] = sizes[format].map((mm) => points(`${mm}mm`));
    }
  }
  const destination = path.resolve(reportDir || path.join(path.dirname(pdfPath), 'qa', path.basename(pdfPath, '.pdf')));
  await fs.mkdir(destination, { recursive: true });
  const expectationsPath = path.join(destination, 'expectations.json');
  await fs.writeFile(expectationsPath, JSON.stringify(checks, null, 2));
  const result = await processRunner.run(config.python.executable, [
    verifier, path.resolve(pdfPath), '--report-dir', destination,
    '--expectations', expectationsPath, '--render',
  ], { failureLabel: `PDF verification failed (report: ${destination}/report.json)`, timeoutMs: config.python.timeout });
  return JSON.parse(result.stdout);
}
