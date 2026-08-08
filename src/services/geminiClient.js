import { CliJsonTranslationClient } from './cliJsonTranslationClient.js';

/** Gemini CLI adapter for the shared JSON translation process runner. */
export class GeminiClient extends CliJsonTranslationClient {
  constructor(options = {}) {
    super({
      ...options,
      command: 'gemini',
      displayName: 'gemini-cli',
      buildArgs: (instructions) => [instructions],
    });
  }
}
