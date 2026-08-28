import { ConfigLoader } from '../src/config/configLoader.js';
import { ProcessRunner } from '../src/utils/processRunner.js';
import { verifyPdf } from '../src/services/pdf/pdfVerification.js';

const pdfPath = process.argv[2];
if (!pdfPath) throw new Error('Usage: node scripts/verify-pdf.js <PDF path>');
const config = await new ConfigLoader().load();
const processRunner = new ProcessRunner();
try {
  const result = await verifyPdf(pdfPath, { config, processRunner });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await processRunner.dispose();
}
