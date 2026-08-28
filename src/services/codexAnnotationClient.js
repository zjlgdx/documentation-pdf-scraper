import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ValidationError } from '../utils/errors.js';

export class CodexAnnotationClient {
  constructor(options = {}) {
    this.processRunner = options.processRunner;
    this.model = options.model || 'gpt-5.6-luna';
    this.reasoningEffort = options.reasoningEffort || 'xhigh';
    this.timeoutMs = options.timeoutMs ?? 300000;
    this.tempRoot = options.tempRoot || os.tmpdir();
  }

  async annotate({ prompt, responseSchema }) {
    if (!this.processRunner) {
      throw new ValidationError('Codex annotation client requires a process runner');
    }

    await fs.mkdir(this.tempRoot, { recursive: true });
    const tempDirectory = await fs.mkdtemp(path.join(this.tempRoot, 'codex-annotation-'));
    const schemaPath = path.join(tempDirectory, 'response-schema.json');
    try {
      await fs.writeFile(schemaPath, JSON.stringify(responseSchema), 'utf8');
      const args = [
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '-C',
        tempDirectory,
        '-m',
        this.model,
        '-c',
        `model_reasoning_effort="${this.reasoningEffort}"`,
        '-s',
        'read-only',
        '--json',
        '--output-schema',
        schemaPath,
        '-',
      ];
      const { stdout } = await this.processRunner.run('codex', args, {
        timeoutMs: this.timeoutMs,
        failureLabel: 'Codex annotation',
        input: prompt,
      });
      return parseFinalAgentMessage(stdout);
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  }
}

function parseFinalAgentMessage(stdout) {
  let finalText = null;
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      finalText = event.item.text;
    }
  }
  if (typeof finalText !== 'string') {
    throw new ValidationError('Codex output did not contain a final annotation agent message');
  }

  const normalized = finalText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new ValidationError(`Codex final annotation message is not valid JSON: ${error.message}`);
  }
}
