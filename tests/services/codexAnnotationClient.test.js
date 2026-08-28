import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAnnotationClient } from '../../src/services/codexAnnotationClient.js';

describe('CodexAnnotationClient', () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-annotation-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('uses ephemeral read-only Luna xhigh and parses the final JSONL agent message', async () => {
    const payload = { segments: [{ segmentId: 'segment-0001', annotations: [] }] };
    const processRunner = {
      run: vi.fn().mockResolvedValue({
        stdout: [
          JSON.stringify({ type: 'thread.started', thread_id: 'test' }),
          JSON.stringify({
            type: 'item.completed',
            item: { type: 'agent_message', text: JSON.stringify(payload) },
          }),
        ].join('\n'),
        stderr: '',
      }),
    };
    const client = new CodexAnnotationClient({
      processRunner,
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      tempRoot,
    });

    await expect(client.annotate({ prompt: 'Annotate.', responseSchema: { type: 'object' } }))
      .resolves.toEqual(payload);
    const [command, args, options] = processRunner.run.mock.calls[0];
    expect(command).toBe('codex');
    expect(args).toEqual(expect.arrayContaining([
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '-m',
      'gpt-5.6-luna',
      '-c',
      'model_reasoning_effort="xhigh"',
      '-s',
      'read-only',
      '--json',
      '--output-schema',
      '-',
    ]));
    expect(options).toMatchObject({ failureLabel: 'Codex annotation', input: 'Annotate.' });
  });

  it('rejects JSONL without a parseable final agent message', async () => {
    const processRunner = {
      run: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ type: 'thread.started', thread_id: 'test' }),
        stderr: '',
      }),
    };
    const client = new CodexAnnotationClient({ processRunner, tempRoot });

    await expect(client.annotate({ prompt: 'Annotate.', responseSchema: {} }))
      .rejects.toThrow(/final annotation/i);
  });
});
