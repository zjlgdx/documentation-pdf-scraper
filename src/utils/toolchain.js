import { ValidationError } from './errors.js';

/** Fail before acquisition when required local render/verification tools are absent. */
export async function checkToolchain(config, processRunner, nodeVersion = process.versions.node) {
  if (Number(nodeVersion.split('.')[0]) < 24) throw new ValidationError('Node.js >= 24 is required');
  const commands = [
    [config.python?.executable || 'python3', ['-c', 'import pymupdf; print("PyMuPDF " + pymupdf.VersionBind)']],
    ['pdftoppm', ['-v']],
  ];
  if (config.markdownPdf?.enabled) {
    commands.push(['pandoc', ['--version']], ['xelatex', ['--version']]);
  }
  const results = await Promise.allSettled(commands.map(async ([command, args]) => {
    const result = await processRunner.run(command, args, { timeoutMs: 15000, failureLabel: `Missing or broken tool: ${command}` });
    return { command, version: (result.stdout || result.stderr).trim().split('\n')[0] };
  }));
  const errors = results.filter((result) => result.status === 'rejected');
  if (errors.length) throw new ValidationError(errors.map((result) => result.reason.message).join('\n'));
  return { node: nodeVersion, tools: results.map((result) => result.value), validatedPandoc: '3.10.2' };
}
