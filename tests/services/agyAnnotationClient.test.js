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
      model: 'gemini-3.7-flash-high',
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
      'gemini-3.7-flash-high',
      '--mode',
      'plan',
      '--sandbox',
      '--output-format',
      'json',
      '--json-schema',
    ]));
    expect(options).toMatchObject({ timeoutMs: 300000, failureLabel: 'AGY annotation' });
  });

  it('rejects an envelope without structured annotation output', async () => {
    const processRunner = {
      run: vi.fn().mockResolvedValue({ stdout: '{"message":"done"}', stderr: '' }),
    };
    const client = new AgyAnnotationClient({ processRunner });

    await expect(client.annotate({ prompt: 'Annotate.', responseSchema: {} }))
      .rejects.toThrow(/structured output/i);
  });
});
