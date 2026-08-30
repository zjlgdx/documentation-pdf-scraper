import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ValidationError } from './errors.js';
import { resolvePdfLayout } from '../services/pdf/layouts/layoutRegistry.js';

async function checkLayoutFonts(layout, processRunner) {
  if (!layout) return [];
  const probeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-layout-fonts-'));
  try {
    const requiredFonts = layout.verification.requiredFonts.map((font) => font.name);
    const probes = await Promise.all(requiredFonts.map(async (font, index) => {
      const inputPath = path.join(probeDir, `font-${index}.tex`);
      const source = String.raw`\documentclass{article}
\usepackage{fontspec}
\IfFontExistsTF{${font}}{\setmainfont{${font}}}{\PackageError{layout-font}{Missing font: ${font}}{}}
\begin{document}Font probe\end{document}
`;
      await fs.writeFile(inputPath, source, 'utf8');
      return { font, inputPath };
    }));
    const results = await Promise.allSettled(probes.map(async ({ font, inputPath }) => {
      await processRunner.run('xelatex', [
        '-halt-on-error',
        '-no-shell-escape',
        '-interaction=nonstopmode',
        `-output-directory=${probeDir}`,
        inputPath,
      ], { timeoutMs: 30000, failureLabel: `Missing layout font: ${font}` });
      return font;
    }));
    const missing = results.flatMap((result, index) =>
      result.status === 'rejected' ? [requiredFonts[index]] : []);
    if (missing.length) {
      throw new ValidationError(
        `PDF layout "${layout.id}" requires unavailable XeLaTeX fonts: ${missing.join(', ')}`,
        { preset: layout.id, missingFonts: missing }
      );
    }
    return results.map((result) => result.value);
  } finally {
    await fs.rm(probeDir, { recursive: true, force: true });
  }
}

/** Fail before acquisition when required local render/verification tools are absent. */
export async function checkToolchain(
  config,
  processRunner,
  nodeVersion = process.versions.node,
  providedLayout
) {
  if (Number(nodeVersion.split('.')[0]) < 24) throw new ValidationError('Node.js >= 24 is required');
  const layout = providedLayout === undefined ? resolvePdfLayout(config) : providedLayout;
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
  const fonts = await checkLayoutFonts(layout, processRunner);
  return {
    node: nodeVersion,
    tools: results.map((result) => result.value),
    fonts,
    layout: layout ? { id: layout.id, version: layout.version, fingerprint: layout.fingerprint } : null,
    validatedPandoc: '3.10.2',
  };
}
