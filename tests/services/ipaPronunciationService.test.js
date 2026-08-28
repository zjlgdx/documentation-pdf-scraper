import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpaPronunciationService } from '../../src/services/ipaPronunciationService.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
};

describe('IpaPronunciationService', () => {
  let cacheDir;

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipa-cache-'));
  });

  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('downloads once, verifies the source, and omits ambiguous or non-word entries', async () => {
    const source = [
      'opaque\t/oʊˈpeɪk/',
      'lead\t/ˈɫɛd/, /ˈɫid/',
      '',
    ].join('\n');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => source,
    });
    const options = {
      enabled: true,
      cacheDir,
      sourceUrl: 'https://example.test/en_US.txt',
      expectedSha256: digest(source),
      fetchImpl,
      logger,
    };
    const service = new IpaPronunciationService(options);

    await expect(service.lookup('Opaque')).resolves.toBe('/oʊˈpeɪk/');
    await expect(service.lookup('lead')).resolves.toBeNull();
    await expect(service.lookup('opaque phrase')).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();

    const cachedService = new IpaPronunciationService({
      ...options,
      fetchImpl: vi.fn().mockRejectedValue(new Error('must not download')),
    });
    await expect(cachedService.lookup('opaque')).resolves.toBe('/oʊˈpeɪk/');
  });

  it('does not fetch when IPA is disabled', async () => {
    const fetchImpl = vi.fn();
    const service = new IpaPronunciationService({ enabled: false, cacheDir, fetchImpl });

    await expect(service.lookup('opaque')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('omits pronunciation when the pinned checksum does not match', async () => {
    const source = 'opaque\t/oʊˈpeɪk/\n';
    const service = new IpaPronunciationService({
      enabled: true,
      cacheDir,
      sourceUrl: 'https://example.test/en_US.txt',
      expectedSha256: digest('different source'),
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, text: async () => source }),
      logger,
    });

    await expect(service.lookup('opaque')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'IPA dictionary unavailable; omitting pronunciations',
      expect.objectContaining({ dialect: 'en-US' })
    );
  });
});

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
