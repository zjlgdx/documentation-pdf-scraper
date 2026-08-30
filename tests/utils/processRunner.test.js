import { describe, it, expect, afterEach, vi } from 'vitest';
import { ProcessRunner } from '../../src/utils/processRunner.js';
import { checkToolchain } from '../../src/utils/toolchain.js';
import { resolvePdfLayout } from '../../src/services/pdf/layouts/layoutRegistry.js';

describe('ProcessRunner', () => {
  const runners = [];
  const createRunner = () => {
    const runner = new ProcessRunner();
    runners.push(runner);
    return runner;
  };
  afterEach(async () => {
    await Promise.all(runners.splice(0).map((runner) => runner.dispose()));
  });

  it('captures real process output and streams progress without a shell', async () => {
    const chunks = [];
    const runner = createRunner();
    const result = await runner.run(process.execPath, ['-e',
      'process.stdout.write(process.argv[1]); process.stderr.write("diagnostic")',
      '中文 $(not-a-command)'], { onStdout: (chunk) => chunks.push(chunk) });
    expect(result).toEqual({ exitCode: 0, stdout: '中文 $(not-a-command)', stderr: 'diagnostic' });
    expect(chunks.join('')).toBe(result.stdout);
    expect(runner.getRunningProcesses()).toEqual([]);
  });

  it('can send input and close stdin for CLIs that otherwise wait for more content', async () => {
    const runner = createRunner();
    const result = await runner.run(process.execPath, ['-e', [
      'let value = "";',
      'process.stdin.on("data", (chunk) => { value += chunk; });',
      'process.stdin.on("end", () => process.stdout.write(`closed:${value}`));',
    ].join('')], { input: '' });

    expect(result.stdout).toBe('closed:');
  });

  it('rejects nonzero exits and missing executables with diagnostics', async () => {
    const runner = createRunner();
    await expect(runner.run(process.execPath, ['-e', 'console.error("bad input"); process.exit(7)']))
      .rejects.toMatchObject({ details: { code: 7, stderr: 'bad input\n' } });
    await expect(runner.run('/nonexistent/pdf-renderer')).rejects.toThrow('ENOENT');
  });

  it('kills a process that ignores SIGTERM on timeout', async () => {
    const runner = createRunner();
    let pid;
    await expect(runner.run(process.execPath, ['-e',
      'process.on("SIGTERM", () => {}); console.log(process.pid); setInterval(() => {}, 1000)'],
    { timeoutMs: 150, onStdout: (chunk) => { pid = Number(chunk.trim()); } }))
      .rejects.toMatchObject({ details: { signal: 'SIGKILL' } });
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('cancels an active process and drains its handles before disposing', async () => {
    const runner = createRunner();
    let ready;
    const started = new Promise((resolve) => { ready = resolve; });
    const job = runner.run(process.execPath, ['-e',
      'console.log("ready"); setInterval(() => {}, 1000)'], { onStdout: ready });
    const rejected = expect(job).rejects.toThrow();
    await started;
    expect(runner.getRunningProcesses()).toHaveLength(1);
    await runner.dispose();
    await rejected;
    expect(runner.getRunningProcesses()).toEqual([]);
    await expect(runner.run(process.execPath)).rejects.toThrow('disposed');
  });

  it('honors AbortSignal and output limits', async () => {
    const runner = createRunner();
    const controller = new AbortController();
    await expect(runner.run(process.execPath, ['-e',
      'console.log("ready"); setInterval(() => {}, 1000)'], {
      signal: controller.signal, onStdout: () => controller.abort(),
    })).rejects.toThrow();
    await expect(runner.run(process.execPath, ['-e', 'console.log("x".repeat(10000))'], {
      maxBuffer: 100,
    })).rejects.toThrow('maxBuffer');
  });

  it('disposes an idle runner without scheduling a grace period', async () => {
    const runner = createRunner();
    await runner.dispose();
    expect(runner.getRunningProcesses()).toEqual([]);
  });

  it('preflights the selected tools and rejects unsupported Node before any process starts', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ stdout: 'tool version\n', stderr: '' }) };
    const config = { python: { executable: '/selected/python' }, markdownPdf: { enabled: true } };
    await expect(checkToolchain(config, runner, '22.0.0')).rejects.toThrow('Node.js >= 24');
    expect(runner.run).not.toHaveBeenCalled();
    const result = await checkToolchain(config, runner, '24.18.0');
    expect(result.tools.map((tool) => tool.command)).toEqual(['/selected/python', 'pdftoppm', 'pandoc', 'xelatex']);
    runner.run.mockRejectedValue(new Error('missing renderer'));
    await expect(checkToolchain(config, runner, '24.18.0')).rejects.toThrow('missing renderer');
  });

  it('probes every layout font through XeLaTeX and names an unavailable font', async () => {
    const layout = resolvePdfLayout({ pdf: { layoutPreset: 'reading-5x8' } });
    const config = { python: { executable: '/selected/python' }, markdownPdf: { enabled: true } };
    const runner = { run: vi.fn().mockResolvedValue({ stdout: 'tool version\n', stderr: '' }) };
    const result = await checkToolchain(config, runner, '24.18.0', layout);
    expect(result.fonts).toEqual(layout.verification.requiredFonts.map((font) => font.name));
    expect(result.layout).toEqual(expect.objectContaining({ id: 'reading-5x8' }));
    expect(runner.run.mock.calls.filter(([command, args]) =>
      command === 'xelatex' && args.some((arg) => arg.endsWith('.tex')))).toHaveLength(3);

    runner.run.mockImplementation(async (command, args) => {
      if (command === 'xelatex' && args.some((arg) => arg.endsWith('font-1.tex'))) {
        throw new Error('font missing');
      }
      return { stdout: 'tool version\n', stderr: '' };
    });
    await expect(checkToolchain(config, runner, '24.18.0', layout)).rejects.toThrow(
      'Noto Sans CJK SC'
    );
  });
});
