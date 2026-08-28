import fs from 'node:fs/promises';
import path from 'node:path';
import { ConfigLoader } from '../src/config/configLoader.js';
import { PandocPdfService } from '../src/services/pandocPdfService.js';
import { ProcessRunner } from '../src/utils/processRunner.js';
import { verifyPdf } from '../src/services/pdf/pdfVerification.js';

// Fixed local content: no website, translation CLI or Chromium dependency.
const { python } = await new ConfigLoader().load();
const config = {
  python,
  markdownSource: { format: 'markdown' },
  markdownPdf: { enabled: true, batchMode: true, toc: true, tocDepth: 3,
    pdfOptions: { format: 'A4', margin: '20mm' } },
};
const destination = path.resolve('output/pdf-smoke');
const markdownDir = path.join(destination, 'markdown');
await fs.mkdir(markdownDir, { recursive: true });
const groups = ['Getting started and establishing a reliable workflow', 'Configuration, rendering and quality verification'];
const titles = {};
const sections = groups.map((title) => ({ title, pages: [] }));
const processRunner = new ProcessRunner();
const renderer = new PandocPdfService({ config, processRunner, metadataService: {
  getSectionStructure: async () => ({ sections }), getArticleTitles: async () => titles,
} });
try {
  const imagePath = path.join(destination, 'pipeline.png');
  await renderer._convertImageToPng(path.resolve('tests/fixtures/pdf/pipeline.svg'), imagePath);
  const fixture = await fs.readFile('tests/fixtures/pdf/article.md', 'utf8');
  for (let index = 1; index <= 8; index++) {
    titles[index] = `Workflow ${index}: configure, generate and inspect a complete technical documentation publication`;
    sections[index <= 4 ? 0 : 1].pages.push({ index: String(index) });
    const content = fixture.replace('ARTICLE_TITLE', titles[index]).replace('IMAGE_PATH', imagePath);
    await fs.writeFile(path.join(markdownDir, `${String(index).padStart(3, '0')}-workflow.md`), content);
  }
  const outputPath = path.join(destination, 'layout-smoke.pdf');
  await renderer.generateBatchPdf(markdownDir, outputPath, config.markdownPdf);
  const result = await verifyPdf(outputPath, { config, processRunner,
    expectations: { titles: Object.values(titles), groups, minTocPages: 2, requireImages: true },
    reportDir: path.join(destination, 'qa'),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await processRunner.dispose();
}
