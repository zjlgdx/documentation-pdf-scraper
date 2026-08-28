import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '../../utils/errors.js';

const verifier = fileURLToPath(new URL('../../python/verify_pdf.py', import.meta.url));

function points(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(mm|cm|in|pt|px)$/);
  if (!match) throw new ValidationError(`Unsupported PDF margin: ${value}`);
  return Number(match[1]) * { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1, px: 0.75 }[match[2]];
}

/** Run the same verification from the application, smoke fixture and CLI. */
export async function verifyPdf(pdfPath, { config, processRunner, expectations = {}, reportDir }) {
  const margin = config.pdf?.kindleOptimized
    ? config.pdf.margin : config.markdownPdf?.pdfOptions?.margin;
  const requireToc = config.markdownPdf?.enabled && config.markdownPdf.batchMode
    && config.markdownPdf.toc !== false;
  const checks = { requireToc, ...expectations };
  if (config.markdownPdf?.enabled) {
    checks.marginLeftPt = points(typeof margin === 'object' ? margin.left || '1in' : margin || '1in');
    checks.marginRightPt = points(typeof margin === 'object' ? margin.right || '1in' : margin || '1in');
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
