import path from 'node:path';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { FileService } from './fileService.js';
import { ValidationError } from '../utils/errors.js';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function isPrivate(address) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.includes(':')) {
    // Mapped/compatible IPv4, local, link-local, ULA and multicast IPv6.
    return /^(::|f[cd]|fe[89ab]|ff)/.test(ip);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

/** Bounded HTTP acquisition. Cached bytes are reused only after HTTP revalidation. */
export class HttpResourceService {
  constructor({ config = {}, logger, resolveHost = lookup } = {}) {
    this.config = config;
    this.network = config.network || {};
    this.logger = logger || { debug() {}, info() {}, warn() {}, error() {} };
    this.files = new FileService(this.logger);
    this.resolveHost = resolveHost;
    this.inflight = new Map();
    this.hostRequests = new Map();
    this.metrics = { requests: 0, downloadedBytes: 0, revalidated: 0 };
  }

  async get(url, kind = 'markdown') {
    const key = `${kind}:${url}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const pending = this._get(url, kind);
    this.inflight.set(key, pending);
    try { return await pending; }
    finally { this.inflight.delete(key); }
  }

  async _validateUrl(value, kind, signal) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ValidationError(`Unsafe HTTP resource URL: ${value}`);
    }
    const domains = kind === 'markdown' ? this.config.allowedDomains : this.network.resourceDomains;
    if (domains?.length && !domains.includes(url.hostname)) {
      throw new ValidationError(`Resource host is not allowed: ${url.hostname}`);
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let rejectOnAbort;
    const aborted = new Promise((_, reject) => {
      rejectOnAbort = () => reject(signal.reason);
      signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    let addresses;
    try {
      addresses = isIP(hostname) ? [{ address: hostname }]
        : await Promise.race([this.resolveHost(hostname, { all: true }), aborted]);
    } finally { signal.removeEventListener('abort', rejectOnAbort); }
    if (!addresses.length || addresses.some(({ address }) => isPrivate(address))) {
      throw new ValidationError(`Private network resource is not allowed: ${url.hostname}`);
    }
    return url;
  }

  async _pace(host, signal) {
    const previous = this.hostRequests.get(host) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => delay(this.network.rateLimitDelay ?? 0, undefined, { signal }));
    this.hostRequests.set(host, next);
    try { await next; }
    finally { if (this.hostRequests.get(host) === next) this.hostRequests.delete(host); }
  }

  async _get(initialUrl, kind) {
    const limit = kind === 'image' ? this.network.maxImageBytes ?? 20 * 1024 * 1024
      : this.network.maxSourceBytes ?? 5 * 1024 * 1024;
    const cacheEnabled = this.network.cacheEnabled !== false;
    const cachePath = path.resolve(this.network.cacheDirectory || '.cache/http', `${digest(`${kind}:${initialUrl}`)}.json`);
    const cached = cacheEnabled ? await this.files.readJson(cachePath, null).catch((error) => {
      // Missing cache is normal; malformed or unreadable caches must be visible.
      if (error.message.includes('ENOENT')) return null;
      throw error;
    }) : null;
    let cachedBytes;
    if (cached) {
      cachedBytes = Buffer.from(cached.body, 'base64');
      if (cached.url !== initialUrl || cachedBytes.length > limit || digest(cachedBytes) !== cached.sha256) {
        throw new ValidationError(`HTTP cache checksum or identity mismatch: ${initialUrl}`);
      }
    }
    let currentUrl = initialUrl;
    let redirects = 0;
    let retries = 0;
    const signal = AbortSignal.timeout(this.network.requestTimeout ?? this.config.pageTimeout ?? 30000);
    for (;;) {
      signal.throwIfAborted();
      const parsed = await this._validateUrl(currentUrl, kind, signal);
      await this._pace(parsed.host, signal);
      const headers = { 'User-Agent': this.network.userAgent || this.config.browser?.userAgent || 'documentation-pdf-scraper/2.0',
        Accept: kind === 'markdown' ? 'text/markdown, text/plain' : 'image/*' };
      if (cached && cached.finalUrl === currentUrl) {
        if (cached.etag) headers['If-None-Match'] = cached.etag;
        if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
      }
      this.metrics.requests++;
      const response = await fetch(currentUrl, { headers, signal, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (++redirects > (this.network.maxRedirects ?? 5)) throw new ValidationError('HTTP redirect limit exceeded');
        const location = response.headers.get('location');
        if (!location) throw new ValidationError('HTTP redirect has no Location');
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
      if (response.status === 429 && this.network.retryOn429 !== false && retries++ < 2) {
        await response.body?.cancel();
        const value = response.headers.get('retry-after');
        const requested = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
        const wait = Number.isFinite(requested) ? Math.max(0, requested) : this.network.rateLimitDelay ?? 1000;
        if (wait > 30000) throw new ValidationError('Retry-After exceeds the 30 second retry budget');
        await delay(wait, undefined, { signal });
        continue;
      }
      if (response.status === 304 && cached && cached.finalUrl === currentUrl) {
        await response.body?.cancel();
        this.metrics.revalidated++;
        return { buffer: cachedBytes, contentType: cached.contentType, finalUrl: currentUrl, fromCache: true };
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}: ${currentUrl}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (kind === 'markdown' && !['text/markdown', 'text/plain', 'text/x-markdown'].includes(contentType.split(';')[0].trim().toLowerCase())) {
        await response.body?.cancel();
        throw new ValidationError(`Expected Markdown response, received ${contentType}: ${currentUrl}`);
      }
      const buffer = await this._readBounded(response, limit);
      this.metrics.downloadedBytes += buffer.length;
      if (cacheEnabled) await this.files.writeJson(cachePath, {
        url: initialUrl, finalUrl: currentUrl, contentType,
        etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'),
        sha256: digest(buffer), body: buffer.toString('base64'),
      });
      return { buffer, contentType, finalUrl: currentUrl, fromCache: false };
    }
  }

  async _readBounded(response, limit) {
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw new ValidationError(`HTTP resource exceeds ${limit} bytes`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > limit) throw new ValidationError(`HTTP resource exceeds ${limit} bytes`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }
}
