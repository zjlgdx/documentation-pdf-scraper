import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileService } from '../../src/services/fileService.js';
import { StateManager } from '../../src/services/stateManager.js';
import { PandocPdfService } from '../../src/services/pandocPdfService.js';

describe('resume identity and batch artifacts', () => {
  let root, files, state, paths;
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const urls = ['https://example.com/a', 'https://example.com/b'];
  const config = { markdown: { enabled: true }, markdownSource: { enabled: true, format: 'mdx' },
    markdownPdf: { enabled: true, batchMode: true } };
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-artifacts-'));
    files = new FileService(logger);
    paths = { getMetadataPath: (name) => path.join(root, `${name}.json`) };
    state = new StateManager(files, paths, logger);
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function acquire() {
    await state.prepareRun(urls, config);
    for (const [index, url] of urls.entries()) {
      const file = path.join(root, `00${index}-article.md`);
      await files.writeText(file, `# Article ${index}\n\nBody ${index}.`);
      await state.recordArtifact(url, file);
    }
    await state.save(true);
  }

  it('reloads a complete atomic snapshot and invalidates changed order or source configuration', async () => {
    await acquire();
    state = new StateManager(files, paths, logger);
    await state.load();
    expect(await state.prepareRun(urls, config)).toBe(true);
    expect(await state.canResume(urls[0])).toBe(true);
    expect(await state.prepareRun([...urls].reverse(), config)).toBe(false);
    expect(state.isProcessed(urls[0])).toBe(false);
    await acquire();
    expect(await state.prepareRun(urls, { ...config, markdownSource: { enabled: true, format: 'markdown' } })).toBe(false);
  });

  it('reuses Markdown across PDF profiles but rejects a missing or changed artifact', async () => {
    await acquire();
    expect(await state.prepareRun(urls, { ...config, pdf: { kindleOptimized: true },
      markdownPdf: { ...config.markdownPdf, pdfOptions: { width: '100mm' } } })).toBe(true);
    await fs.writeFile(path.join(root, '000-article.md'), '# Wrong book');
    expect(await state.canResume(urls[0])).toBe(false);
    await expect(state.getArtifacts()).rejects.toThrow('Missing or changed artifact');
    await fs.unlink(path.join(root, '001-article.md'));
    expect(await state.canResume(urls[1])).toBe(false);
  });

  it('assembles only manifest artifacts and checks URL/index identity and bytes', async () => {
    await acquire();
    const artifacts = await state.getArtifacts();
    await fs.writeFile(path.join(root, '099-stale.md'), '# Stale article');
    const sections = [{ title: 'Collection', pages: urls.map((url, index) => ({ url, index: String(index) })) }];
    const renderer = new PandocPdfService({ config, logger, metadataService: {
      getSectionStructure: async () => ({ sections }), getArticleTitles: async () => ({ 0: 'Article 0', 1: 'Article 1' }),
    } });
    const render = vi.spyOn(renderer, '_renderContent').mockResolvedValue();
    await renderer.generateBatchPdf(root, 'unused.pdf', { artifacts });
    expect(render.mock.calls[0][0]).not.toContain('Stale article');
    expect(render.mock.calls[0][0]).toContain('Body 1.');
    sections[0].pages[0].url = urls[1];
    await expect(renderer.generateBatchPdf(root, 'unused.pdf', { artifacts })).rejects.toThrow('Artifact URL mismatch');
    sections[0].pages[0].url = urls[0];
    await fs.writeFile(artifacts[0].path, '# Changed after manifest');
    await expect(renderer.generateBatchPdf(root, 'unused.pdf', { artifacts })).rejects.toThrow('Artifact checksum mismatch');
  });
});
