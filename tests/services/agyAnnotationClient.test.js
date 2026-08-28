import { describe, expect, it, vi } from 'vitest';
import { AgyAnnotationClient } from '../../src/services/agyAnnotationClient.js';

describe('AgyAnnotationClient', () => {
  it('uses the OAuth CLI in sandboxed JSON-schema mode and parses structured_output', async () => {
    const payload = { segments: [{ segmentId: 'segment-0001', annotations: [] }] };
    const processRunner = {
      run: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ structured_output: payload }),
        stderr: '',
      }),
    };
    const client = new AgyAnnotationClient({
      processRunner,
      model: 'gemini-3.7-flash-medium',
      timeoutMs: 300000,
    });

    await expect(client.annotate({ prompt: 'Annotate.', responseSchema: { type: 'object' } }))
      .resolves.toEqual(payload);
    const [command, args, options] = processRunner.run.mock.calls[0];
    expect(command).toBe('agy');
    expect(args).toEqual(expect.arrayContaining([
      '-p',
      'Annotate.',
      '--model',
      'gemini-3.7-flash-medium',
      '--sandbox',
      '--output-format',
      'json',
      '--json-schema',
    ]));
    expect(args).not.toContain('--mode');
    expect(args).not.toContain('plan');
    expect(options).toMatchObject({ timeoutMs: 300000, failureLabel: 'AGY annotation' });
  });

  it('rejects an envelope without structured output using safe retry diagnostics', async () => {
    const response = 'Once approved, I will create the annotations.';
    const processRunner = {
      run: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ status: 'SUCCESS', response }),
        stderr: '',
      }),
    };
    const client = new AgyAnnotationClient({ processRunner });

    const error = await client.annotate({ prompt: 'Annotate.', responseSchema: {} })
      .catch((reason) => reason);

    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        reason: 'missing_structured_output',
        status: 'SUCCESS',
        keys: ['response', 'status'],
        responseLength: response.length,
      },
    });
    expect(JSON.stringify(error.details)).not.toContain(response);
  });
});
