import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const IPA_DICTIONARY_REVISION = '43c3570eb3553bdd19fccd2bd0091534889af023';

export const IPA_DICTIONARY_INFO = Object.freeze({
  dialect: 'en-US',
  source: 'open-dict-data/ipa-dict',
  sourceUrl: `https://raw.githubusercontent.com/open-dict-data/ipa-dict/${IPA_DICTIONARY_REVISION}/data/en_US.txt`,
  sha256: '2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67',
});

export class IpaPronunciationService {
  constructor(options = {}) {
    this.enabled = options.enabled ?? false;
    this.cacheDir = options.cacheDir || path.join(process.cwd(), '.temp', 'annotation_cache', 'ipa');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.sourceUrl = options.sourceUrl || IPA_DICTIONARY_INFO.sourceUrl;
    this.expectedSha256 = options.expectedSha256 || IPA_DICTIONARY_INFO.sha256;
    this.cachePath = path.join(
      this.cacheDir,
      `ipa-dict-en_US-${IPA_DICTIONARY_REVISION.slice(0, 12)}.txt`
    );
    this.dictionaryPromise = null;
    this.loadWarningEmitted = false;
  }

  async lookup(value) {
    if (!this.enabled) return null;
    const word = normalizeLookupWord(value);
    if (!word) return null;
    try {
      const dictionary = await this._getDictionary();
      return dictionary.get(word) || null;
    } catch (error) {
      if (!this.loadWarningEmitted) {
        this.loadWarningEmitted = true;
        this.logger?.warn('IPA dictionary unavailable; omitting pronunciations', {
          dialect: IPA_DICTIONARY_INFO.dialect,
          reason: error.message,
        });
      }
      return null;
    }
  }

  _getDictionary() {
    this.dictionaryPromise ||= this._loadDictionary();
    return this.dictionaryPromise;
  }

  async _loadDictionary() {
    const cached = await this._readVerifiedCache();
    const source = cached || await this._downloadVerifiedSource();
    const dictionary = parseDictionary(source);
    if (dictionary.size === 0) throw new Error('IPA dictionary did not contain usable entries');
    this.logger?.info('IPA pronunciation dictionary loaded', {
      dialect: IPA_DICTIONARY_INFO.dialect,
      entries: dictionary.size,
      cached: Boolean(cached),
    });
    return dictionary;
  }

  async _readVerifiedCache() {
    try {
      const source = await fs.readFile(this.cachePath, 'utf8');
      if (sha256(source) === this.expectedSha256) return source;
      this.logger?.warn('Ignoring IPA dictionary cache with an invalid checksum', {
        cachePath: this.cachePath,
      });
      return null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async _downloadVerifiedSource() {
    if (typeof this.fetchImpl !== 'function') throw new Error('Fetch is unavailable');
    const response = await this.fetchImpl(this.sourceUrl, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`IPA dictionary download failed with HTTP ${response.status}`);
    const source = await response.text();
    if (sha256(source) !== this.expectedSha256) {
      throw new Error('IPA dictionary download failed checksum verification');
    }
    await this._writeCache(source);
    return source;
  }

  async _writeCache(source) {
    const temporaryPath = `${this.cachePath}.tmp-${randomUUID()}`;
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(temporaryPath, source, 'utf8');
      await fs.rename(temporaryPath, this.cachePath);
    } catch (error) {
      this.logger?.warn('Failed to cache IPA dictionary; continuing in memory', {
        reason: error.message,
      });
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }
}

function parseDictionary(source) {
  const dictionary = new Map();
  for (const line of source.split(/\r?\n/)) {
    const separator = line.indexOf('\t');
    if (separator <= 0) continue;
    const word = line.slice(0, separator).toLowerCase();
    const pronunciation = line.slice(separator + 1).trim();
    if (pronunciation.includes(', ') || !/^\/[^/\r\n]+\/$/.test(pronunciation)) continue;
    dictionary.set(word, pronunciation);
  }
  return dictionary;
}

function normalizeLookupWord(value) {
  const word = String(value).trim().normalize('NFKC').replaceAll('’', "'");
  if (!/^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(word)) return null;
  return word.toLowerCase();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
