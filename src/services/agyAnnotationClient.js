import { ValidationError } from '../utils/errors.js';

export class AgyAnnotationClient {
  constructor(options = {}) {
    this.processRunner = options.processRunner;
    this.model = options.model || 'gemini-3.7-flash-high';
    this.timeoutMs = options.timeoutMs ?? 300000;
  }

  async annotate({ prompt, responseSchema }) {
    if (!this.processRunner) {
      throw new ValidationError('AGY annotation client requires a process runner');
    }

    const printTimeoutMinutes = Math.max(1, Math.ceil(this.timeoutMs / 60000));
    const args = [
      '-p',
      prompt,
      '--model',
      this.model,
      '--mode',
      'plan',
      '--sandbox',
      '--print-timeout',
      `${printTimeoutMinutes}m`,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(responseSchema),
    ];
    const { stdout } = await this.processRunner.run('agy', args, {
      timeoutMs: this.timeoutMs,
      failureLabel: 'AGY annotation',
    });

    const envelope = parseJson(stdout, 'AGY output');
    const structured = envelope.structured_output ?? envelope.structuredOutput;
    if (structured == null) {
      throw new ValidationError('AGY output did not contain structured output for annotations');
    }
    return typeof structured === 'string'
      ? parseJson(structured, 'AGY structured output')
      : structured;
  }
}

function parseJson(value, label) {
  try {
    return JSON.parse(String(value).trim());
  } catch (error) {
    throw new ValidationError(`${label} is not valid JSON: ${error.message}`);
  }
}
