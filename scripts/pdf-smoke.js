import fs from 'node:fs/promises';
import path from 'node:path';
import { ConfigLoader } from '../src/config/configLoader.js';
import { PandocPdfService } from '../src/services/pandocPdfService.js';
import { ProcessRunner } from '../src/utils/processRunner.js';
import { verifyPdf } from '../src/services/pdf/pdfVerification.js';
import { MarkdownNormalizer } from '../src/services/pdf/markdownNormalizer.js';

// Fixed local content: no website, translation CLI or Chromium dependency.
const loaded = await new ConfigLoader().load();
const format = process.argv[2] || 'A4';
const config = {
  python: loaded.python,
  ...(process.env.PDF_PROFILE ? { pdf: loaded.pdf } : {}),
  markdownSource: { format: 'markdown' },
  markdownPdf: { enabled: true, batchMode: true, toc: true, tocDepth: 3,
    pdfOptions: { format, margin: '20mm' } },
};
const destination = path.resolve('output/pdf-smoke', process.env.PDF_PROFILE || (format === 'A4' ? '' : format.toLowerCase()));
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
  const mdx = new MarkdownNormalizer({ markdownSource: { format: 'mdx' } })._cleanMarkdownContent(
    '<Card title="Semantic card title" href="https://example.com/guide">Card body remains readable.</Card>\n\nThe static limit is {1000}.'
  );
  for (let index = 1; index <= 8; index++) {
    titles[index] = `Workflow ${index}: configure, generate and inspect a complete technical documentation publication`;
    sections[index <= 4 ? 0 : 1].pages.push({ index: String(index) });
    const content = fixture.replace('ARTICLE_TITLE', titles[index]).replace('IMAGE_PATH', imagePath) + '\n\n' + mdx;
    await fs.writeFile(path.join(markdownDir, `${String(index).padStart(3, '0')}-workflow.md`), content);
  }
  const outputPath = path.join(destination, 'layout-smoke.pdf');
  await renderer.generateBatchPdf(markdownDir, outputPath, config.markdownPdf);
  const result = await verifyPdf(outputPath, { config, processRunner,
    expectations: { titles: Object.values(titles), articleTitles: Object.values(titles), groups, minTocPages: 2, requireImages: true,
      previewSnippets: ['indented_literal = "preserved"', '英语批注', 'Nested child keeps its parent',
        'environment.longConfigurationPropertyNameForDocumentationTesting'],
      bodySnippets: ['Semantic card title', 'Card body remains readable.', 'The static limit is 1000.',
        '英语批注', 'under the hood', '/ˈbʌndəl/', '/ˈsɜːfɪs/', 'Nested child keeps its parent', '| --- | --- |',
        'indented_literal = "preserved"'] },
    reportDir: path.join(destination, 'qa'),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await processRunner.dispose();
}
