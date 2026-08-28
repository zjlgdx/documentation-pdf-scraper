import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const US_DICTIONARY_REVISION = '43c3570eb3553bdd19fccd2bd0091534889af023';
const UK_DICTIONARY_REVISION = '1062be14adc96c358f2087ac5449d72130c7a6f4';

export const IPA_DICTIONARIES = Object.freeze({
  us: Object.freeze({
    dialect: 'en-US',
    transcription: 'broad learner IPA',
    source: 'open-dict-data/ipa-dict',
    sourceUrl: `https://raw.githubusercontent.com/open-dict-data/ipa-dict/${US_DICTIONARY_REVISION}/data/en_US.txt`,
    sha256: '2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67',
    format: 'ipa-dict',
    cacheFile: `ipa-dict-en_US-${US_DICTIONARY_REVISION.slice(0, 12)}.txt`,
  }),
  uk: Object.freeze({
    dialect: 'en-GB',
    transcription: 'broad learner IPA',
    source: 'JoseLlarena/Britfone',
    sourceUrl: `https://raw.githubusercontent.com/JoseLlarena/Britfone/${UK_DICTIONARY_REVISION}/britfone.main.3.0.1.csv`,
    sha256: '59f197e98520856d1cc88e380beb54e4314d8712efc4d588b6778819c502d920',
    format: 'britfone',
    cacheFile: `britfone-en_GB-${UK_DICTIONARY_REVISION.slice(0, 12)}.csv`,
  }),
});

// Retain the original export for callers that only need the American source metadata.
export const IPA_DICTIONARY_INFO = IPA_DICTIONARIES.us;

export class IpaPronunciationService {
  constructor(options = {}) {
    this.enabled = options.enabled ?? false;
    this.cacheDir = options.cacheDir || path.join(process.cwd(), '.temp', 'annotation_cache', 'ipa');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.defaultAccent = options.accent === 'us' ? 'us' : 'uk';
    this.sourceOverrides = new Map();
    if (options.sourceUrl || options.expectedSha256) {
      this.sourceOverrides.set(this.defaultAccent, {
        ...IPA_DICTIONARIES[this.defaultAccent],
        sourceUrl: options.sourceUrl || IPA_DICTIONARIES[this.defaultAccent].sourceUrl,
        sha256: options.expectedSha256 || IPA_DICTIONARIES[this.defaultAccent].sha256,
      });
    }
    this.dictionaryPromises = new Map();
    this.loadWarnings = new Set();
  }

  async lookup(value, accent = this.defaultAccent) {
    if (!this.enabled) return null;
    const word = normalizeLookupWord(value);
    const info = this._dictionaryInfo(accent);
    if (!word || !info) return null;
    try {
      const dictionary = await this._getDictionary(accent, info);
      return dictionary.get(word) || null;
    } catch (error) {
      if (!this.loadWarnings.has(accent)) {
        this.loadWarnings.add(accent);
        this.logger?.warn('IPA dictionary unavailable; omitting pronunciations', {
          dialect: info.dialect,
          reason: error.message,
        });
      }
      return null;
    }
  }

  _dictionaryInfo(accent) {
    if (accent !== 'uk' && accent !== 'us') return null;
    return this.sourceOverrides.get(accent) || IPA_DICTIONARIES[accent];
  }

  _getDictionary(accent, info) {
    if (!this.dictionaryPromises.has(accent)) {
      this.dictionaryPromises.set(accent, this._loadDictionary(info));
    }
    return this.dictionaryPromises.get(accent);
  }

  async _loadDictionary(info) {
    const cached = await this._readVerifiedCache(info);
    const source = cached || await this._downloadVerifiedSource(info);
    const dictionary = info.format === 'britfone'
      ? parseBritfoneDictionary(source)
      : parseGeneralAmericanDictionary(source);
    if (dictionary.size === 0) throw new Error('IPA dictionary did not contain usable entries');
    this.logger?.info('IPA pronunciation dictionary loaded', {
      dialect: info.dialect,
      entries: dictionary.size,
      cached: Boolean(cached),
    });
    return dictionary;
  }

  async _readVerifiedCache(info) {
    const cachePath = path.join(this.cacheDir, info.cacheFile);
    try {
      const source = await fs.readFile(cachePath, 'utf8');
      if (sha256(source) === info.sha256) return source;
      this.logger?.warn('Ignoring IPA dictionary cache with an invalid checksum', {
        cachePath,
      });
      return null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async _downloadVerifiedSource(info) {
    if (typeof this.fetchImpl !== 'function') throw new Error('Fetch is unavailable');
    const response = await this.fetchImpl(info.sourceUrl, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`IPA dictionary download failed with HTTP ${response.status}`);
    const source = await response.text();
    if (sha256(source) !== info.sha256) {
      throw new Error('IPA dictionary download failed checksum verification');
    }
    await this._writeCache(source, info);
    return source;
  }

  async _writeCache(source, info) {
    const cachePath = path.join(this.cacheDir, info.cacheFile);
    const temporaryPath = `${cachePath}.tmp-${randomUUID()}`;
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(temporaryPath, source, 'utf8');
      await fs.rename(temporaryPath, cachePath);
    } catch (error) {
      this.logger?.warn('Failed to cache IPA dictionary; continuing in memory', {
        reason: error.message,
      });
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }
}

function parseGeneralAmericanDictionary(source) {
  const dictionary = new Map();
  for (const line of source.split(/\r?\n/)) {
    const separator = line.indexOf('\t');
    if (separator <= 0) continue;
    const word = line.slice(0, separator).toLowerCase();
    const pronunciation = line.slice(separator + 1).trim();
    if (pronunciation.includes(', ') || !/^\/[^/\r\n]+\/$/.test(pronunciation)) continue;
    dictionary.set(word, normalizeGeneralAmericanIpa(pronunciation));
  }
  return dictionary;
}

function parseBritfoneDictionary(source) {
  const dictionary = new Map();
  const ambiguous = new Set();
  for (const line of source.split(/\r?\n/)) {
    const separator = line.indexOf(',');
    if (separator <= 0) continue;
    const rawWord = line.slice(0, separator).trim();
    if (/\(\d+\)$/u.test(rawWord)) continue;
    const word = rawWord.toLowerCase();
    const tokens = line.slice(separator + 1).trim().split(/\s+/u).filter(Boolean);
    if (tokens.length === 0 || ambiguous.has(word)) continue;
    if (dictionary.has(word)) {
      dictionary.delete(word);
      ambiguous.add(word);
      continue;
    }
    dictionary.set(word, normalizeBritishLearnerIpa(tokens));
  }
  return dictionary;
}

/**
 * Convert the source's CMU-derived narrow symbols to conventional broad IPA.
 * Stress marks precede syllables, so only the first vowel after a stress mark
 * can represent stressed ARPABET AH (STRUT /ʌ/); later schwas stay /ə/.
 */
function normalizeGeneralAmericanIpa(pronunciation) {
  return pronunciation
    .replace(/([ˈˌ][^aæɑɔəɛɝeiɪouʊ/]*?)ə/gu, '$1ʌ')
    .replace(/([ˈˌ][^aæɑɔəɛɝeiɪouʊʌ/]*?)ɝ/gu, '$1ɜːr')
    .replaceAll('ɝ', 'ər')
    .replaceAll('ɹ', 'r')
    .replaceAll('ɫ', 'l');
}

const BRITISH_VOWELS = new Set([
  'aɪ', 'aʊ', 'eɪ', 'i', 'iː', 'uː', 'æ', 'ɑː', 'ɒ', 'ɔɪ', 'ɔː', 'ə', 'əʊ',
  'e', 'eə', 'ɜː', 'ɪ', 'ɪə', 'ʊ', 'ʊə', 'ʌ',
]);

const BRITISH_ONSETS = new Set([
  'b', 'd', 'dʒ', 'f', 'ɡ', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't',
  'tʃ', 'v', 'w', 'z', 'ð', 'ʃ', 'ʒ', 'θ',
  'bl', 'br', 'dr', 'fl', 'fr', 'ɡl', 'ɡr', 'kl', 'kr', 'pl', 'pr', 'sk', 'sl',
  'sm', 'sn', 'sp', 'st', 'sw', 'tr', 'tw', 'θr', 'ʃr',
  'bj', 'dj', 'fj', 'hj', 'kj', 'lj', 'mj', 'nj', 'pj', 'sj', 'tj', 'vj', 'zj',
  'ɡj', 'θj',
  'skr', 'skw', 'spl', 'spr', 'str',
]);

function normalizeBritishLearnerIpa(sourceTokens) {
  const tokens = sourceTokens.map((token) => token
    .replaceAll('ɐ', 'ʌ')
    .replaceAll('ɛ', 'e')
    .replaceAll('ɹ', 'r')
    .replaceAll('g', 'ɡ'));

  for (let index = 0; index < tokens.length; index += 1) {
    const stress = /^[ˈˌ]/u.exec(tokens[index])?.[0];
    if (!stress) continue;
    tokens[index] = tokens[index].slice(stress.length);

    let previousVowel = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (BRITISH_VOWELS.has(stripStress(tokens[cursor]))) {
        previousVowel = cursor;
        break;
      }
    }
    const onsetStart = previousVowel < 0
      ? 0
      : findBritishOnsetStart(tokens, previousVowel + 1, index);
    tokens[onsetStart] = `${stress}${tokens[onsetStart]}`;
  }

  return `/${tokens.join('')}/`;
}

function findBritishOnsetStart(tokens, start, end) {
  for (let candidate = start; candidate < end; candidate += 1) {
    const onset = tokens.slice(candidate, end).map(stripStress).join('');
    if (BRITISH_ONSETS.has(onset)) return candidate;
  }
  return end;
}

function stripStress(token) {
  return token.replace(/^[ˈˌ]/u, '');
}

function normalizeLookupWord(value) {
  const word = String(value).trim().normalize('NFKC').replaceAll('’', "'");
  if (!/^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(word)) return null;
  return word.toLowerCase();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
