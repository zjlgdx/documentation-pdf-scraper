import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpResourceService } from '../../src/services/httpResourceService.js';

describe('HttpResourceService', () => {
  let cacheDirectory, service;
  beforeEach(async () => {
    cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'http-resource-'));
    service = new HttpResourceService({
      config: { allowedDomains: ['docs.example.com'], network: { cacheDirectory, rateLimitDelay: 0 } },
      resolveHost: vi.fn().mockResolvedValue([{ address: '93.184.216.34' }]),
    });
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  });

  const url = 'https://docs.example.com/guide.md';
  const response = (body = '# Guide', headers = {}) => new Response(body, {
    headers: { 'content-type': 'text/markdown', etag: '"revision-1"', ...headers },
  });

  it('revalidates cached bytes and never uses them after a server failure', async () => {
    fetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response('down', { status: 503 }));
    expect((await service.get(url)).buffer.toString()).toBe('# Guide');
    expect((await service.get(url)).fromCache).toBe(true);
    expect(fetch.mock.calls[1][1].headers['If-None-Match']).toBe('"revision-1"');
    await expect(service.get(url)).rejects.toThrow('HTTP 503');
    expect(service.metrics).toEqual({ requests: 3, downloadedBytes: 7, revalidated: 1 });
  });

  it('refreshes changed content and uses Last-Modified when ETag is absent', async () => {
    const modified = 'Wed, 26 Aug 2026 12:00:00 GMT';
    fetch.mockResolvedValueOnce(new Response('# Old', { headers: { 'content-type': 'text/plain', 'last-modified': modified } }))
      .mockResolvedValueOnce(response('# New'));
    await service.get(url);
    expect((await service.get(url)).buffer.toString()).toBe('# New');
    expect(fetch.mock.calls[1][1].headers['If-Modified-Since']).toBe(modified);
  });

  it('deduplicates in-flight requests and detects cache corruption', async () => {
    fetch.mockImplementation(() => Promise.resolve(response()));
    await Promise.all([service.get(url), service.get(url)]);
    expect(fetch).toHaveBeenCalledOnce();
    const [file] = await fs.readdir(cacheDirectory);
    const stored = JSON.parse(await fs.readFile(path.join(cacheDirectory, file), 'utf8'));
    await fs.writeFile(path.join(cacheDirectory, file), JSON.stringify({ ...stored, body: 'Y2hhbmdlZA==' }));
    await expect(service.get(url)).rejects.toThrow('cache checksum');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['http://127.0.0.1/private', 'http://169.254.169.254/latest', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'https://user:password@example.com/'])(
    'rejects unsafe image URLs: %s', async (target) => {
    await expect(service.get(target, 'image')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    });

  it('checks DNS and the configured image allowlist at each redirect', async () => {
    service.network.resourceDomains = ['images.example.com'];
    fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://outside.example.com/image.png' } }));
    await expect(service.get('https://images.example.com/a.png', 'image')).rejects.toThrow('host is not allowed');
    expect(fetch).toHaveBeenCalledOnce();
    service.resolveHost.mockResolvedValue([{ address: '10.0.0.4' }]);
    await expect(service.get(url)).rejects.toThrow('Private network');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('limits redirects and does not forward validators to a different resource', async () => {
    fetch.mockResolvedValueOnce(response());
    await service.get(url);
    service.network.maxRedirects = 1;
    fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: '/moved.md' } }));
    await expect(service.get(url)).rejects.toThrow('redirect limit');
    expect(fetch.mock.calls[2][1].headers['If-None-Match']).toBeUndefined();
  });

  it.each([true, false])('bounds both announced and streamed bytes (Content-Length=%s)', async (announced) => {
    service.network.maxSourceBytes = 5;
    fetch.mockResolvedValue(response('# Longer than limit', announced ? { 'content-length': '100' } : {}));
    await expect(service.get(url)).rejects.toThrow('exceeds 5 bytes');
    expect(await fs.readdir(cacheDirectory)).toEqual([]);
  });

  it('honors Retry-After, limits retries, and supports disabling retryOn429', async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(response());
    expect((await service.get(url)).buffer.toString()).toBe('# Guide');
    service.network.retryOn429 = false;
    fetch.mockResolvedValue(new Response(null, { status: 429 }));
    await expect(service.get(url)).rejects.toThrow('HTTP 429');
    expect(fetch).toHaveBeenCalledTimes(3);
    service.network.retryOn429 = true;
    await expect(service.get(url)).rejects.toThrow('HTTP 429');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('includes DNS lookup in the request timeout budget', async () => {
    service.network.requestTimeout = 10;
    service.resolveHost.mockImplementation(() => new Promise(() => {}));
    await expect(service.get(url)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not cache HTML masquerading as native Markdown', async () => {
    fetch.mockResolvedValue(new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(service.get(url)).rejects.toThrow('Expected Markdown');
    expect(await fs.readdir(cacheDirectory)).toEqual([]);
  });
});
