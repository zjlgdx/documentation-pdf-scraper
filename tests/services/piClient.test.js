import { EventEmitter } from 'events';
import { describe, expect, test, vi } from 'vitest';
import { PiClient } from '../../src/services/piClient.js';

describe('PiClient', () => {
  test('uses tool-free print mode and parses JSON output', async () => {
    const spawn = vi.fn(() => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const handlers = {};
      const child = {
        stdout,
        stderr,
        stdin: { write: vi.fn(), end: vi.fn() },
        kill: vi.fn(),
        on: (event, handler) => {
          handlers[event] = handler;
        },
      };

      process.nextTick(() => {
        stdout.emit('data', Buffer.from('{"id":"译文"}'));
        handlers.close?.(0);
      });
      return child;
    });

    const client = new PiClient({ spawn, timeoutMs: 5000, model: 'test-model' });
    const result = await client.translateJson({
      instructions: 'Translate values.',
      inputMap: { id: 'text' },
    });

    expect(result).toEqual({ id: '译文' });
    expect(spawn).toHaveBeenCalledOnce();
    const [command, args] = spawn.mock.calls[0];
    expect(command).toBe('pi');
    expect(args).toEqual(expect.arrayContaining(['--print', '--no-tools', '--model', 'test-model']));
  });
});
