import { ValidationError } from '../utils/errors.js';

export const AGY_ANNOTATION_ERROR_REASONS = Object.freeze({
  MISSING_STRUCTURED_OUTPUT: 'missing_structured_output',
});

export class AgyAnnotationClient {
  constructor(options = {}) {
    this.processRunner = options.processRunner;
    this.model = options.model || 'gemini-3.7-flash-medium';
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
    const isObjectEnvelope = envelope && typeof envelope === 'object' && !Array.isArray(envelope);
    const structured = isObjectEnvelope
      ? envelope.structured_output ?? envelope.structuredOutput
      : null;
    if (structured == null) {
      throw new ValidationError(
        'AGY output did not contain structured output for annotations',
        {
          reason: AGY_ANNOTATION_ERROR_REASONS.MISSING_STRUCTURED_OUTPUT,
          status: typeof envelope?.status === 'string' ? envelope.status : null,
          keys: isObjectEnvelope ? Object.keys(envelope).sort() : [],
          responseLength: typeof envelope?.response === 'string' ? envelope.response.length : 0,
        }
      );
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
