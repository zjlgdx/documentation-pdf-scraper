import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyPdf } from '../../../src/services/pdf/pdfVerification.js';

describe('verifyPdf', () => {
  let reportDir;
  let config;
  let processRunner;
  beforeEach(async () => {
    reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-verification-'));
    config = { python: { executable: 'selected-python', timeout: 1234 },
      markdownPdf: { enabled: true, batchMode: true, toc: true, pdfOptions: { margin: '20mm' } } };
    processRunner = { run: vi.fn().mockResolvedValue({ stdout: '{"passed":true,"foundTitles":[]}' }) };
  });
  afterEach(async () => { await fs.rm(reportDir, { recursive: true, force: true }); });

  it('uses the selected Python runtime and converts the effective profile to points', async () => {
    config.pdf = { kindleOptimized: true, margin: { left: '1cm', right: '12pt' } };
    await verifyPdf('book.pdf', { config, processRunner, reportDir });
    const expectations = JSON.parse(await fs.readFile(path.join(reportDir, 'expectations.json')));
    expect(expectations.marginLeftPt).toBeCloseTo(72 / 2.54);
    expect(expectations.marginRightPt).toBe(12);
    expect(expectations.requireToc).toBe(true);
    expect(processRunner.run).toHaveBeenCalledWith('selected-python', expect.arrayContaining([
      path.resolve('book.pdf'), '--report-dir', reportDir, '--render',
    ]), expect.objectContaining({ timeoutMs: 1234 }));
  });

  it('rejects invalid margins before starting a process', async () => {
    config.markdownPdf.pdfOptions.margin = 'auto';
    await expect(verifyPdf('book.pdf', { config, processRunner, reportDir })).rejects.toThrow('Unsupported PDF margin');
    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it('propagates failed PDF checks without trying another verifier', async () => {
    processRunner.run.mockRejectedValue(new Error('PDF overflow'));
    await expect(verifyPdf('book.pdf', { config, processRunner, reportDir })).rejects.toThrow('PDF overflow');
    expect(processRunner.run).toHaveBeenCalledOnce();
  });

  it('uses layout pack geometry, fonts, and identity instead of inherited A4 options', async () => {
    config.pdf = { layoutPreset: 'reading-5x8' };
    config.markdownPdf.pdfOptions = { format: 'A4', margin: '20mm' };
    await verifyPdf('book.pdf', { config, processRunner, reportDir });
    const expectations = JSON.parse(await fs.readFile(path.join(reportDir, 'expectations.json')));
    expect(expectations.pageWidthPt).toBe(360);
    expect(expectations.pageHeightPt).toBe(576);
    expect(expectations.marginTopPt).toBeCloseTo(46.8);
    expect(expectations.requiredFonts.map((font) => font.name)).toEqual([
      'Noto Serif CJK SC', 'Noto Sans CJK SC', 'DejaVu Sans Mono',
    ]);
    expect(expectations.layout).toEqual(expect.objectContaining({
      id: 'reading-5x8', version: '1.0.0', fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });
});
