import { execFile } from 'node:child_process';
import { ProcessingError } from './errors.js';

/** Shared lifetime, output limits and cancellation for Pandoc, LaTeX and Python. */
export class ProcessRunner {
  constructor() {
    this.running = new Set();
    this.disposed = false;
  }

  async run(command, args = [], options = {}) {
    if (this.disposed) throw new ProcessingError('Process runner is disposed');
    const { timeoutMs = 300000, maxBuffer = 10 * 1024 * 1024, signal, cwd, env, input,
      onStdout, failureLabel = command } = options;
    const task = { command };
    task.done = new Promise((resolve, reject) => {
      let outputError;
      task.child = execFile(command, args, {
        timeout: timeoutMs, maxBuffer, signal, cwd, env, encoding: 'utf8',
        // Never return while a timed-out or cancelled renderer can still write output.
        killSignal: 'SIGKILL',
      }, (error, stdout, stderr) => {
        const cause = outputError || error;
        if (cause) {
          reject(new ProcessingError(`${failureLabel}: ${cause.message}\n${stderr || stdout}`, {
            code: cause.code, signal: cause.signal, stdout, stderr,
          }));
        } else {
          resolve({ exitCode: 0, stdout, stderr });
        }
      });
      task.closed = new Promise((resolve) => task.child.once('close', resolve));
      if (onStdout) {
        task.child.stdout.on('data', (chunk) => {
          try {
            onStdout(chunk);
          } catch (error) {
            outputError = error;
            task.child.kill('SIGKILL');
          }
        });
      }
      if (input !== undefined) {
        task.child.stdin.on('error', (error) => {
          outputError = outputError || error;
          task.child.kill('SIGKILL');
        });
        task.child.stdin.end(input);
      }
    });
    this.running.add(task);
    try {
      return await task.done;
    } finally {
      await task.closed;
      this.running.delete(task);
    }
  }

  getRunningProcesses() {
    return [...this.running].map(({ command, child }) => ({ command, pid: child.pid }));
  }

  async dispose() {
    this.disposed = true;
    const tasks = [...this.running];
    for (const { child } of tasks) child?.kill('SIGKILL');
    await Promise.allSettled(tasks.flatMap(({ done, closed }) => [done, closed]));
  }
}
