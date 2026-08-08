import { CliJsonTranslationClient } from './cliJsonTranslationClient.js';

/** Pi CLI adapter configured for deterministic, tool-free one-shot translation. */
export class PiClient extends CliJsonTranslationClient {
  constructor(options = {}) {
    const modelArgs = options.model ? ['--model', options.model] : [];
    const providerArgs = options.provider ? ['--provider', options.provider] : [];

    super({
      ...options,
      command: 'pi',
      displayName: 'pi-cli',
      buildArgs: (instructions) => [
        '--print',
        '--no-session',
        '--no-tools',
        '--no-context-files',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-approve',
        ...providerArgs,
        ...modelArgs,
        '--system-prompt',
        instructions,
        'Translate the JSON object from stdin and return only the JSON object.',
      ],
    });
  }
}
