import { describe, expect, it } from 'vitest';
import { LayoutRegistry, resolvePdfLayout } from '../../../../src/services/pdf/layouts/layoutRegistry.js';
import { reading5x8 } from '../../../../src/services/pdf/layouts/packs/reading5x8.js';
import { PandocLayoutAdapter } from '../../../../src/services/pdf/layouts/pandocLayoutAdapter.js';
import { getLayoutVerificationExpectations } from '../../../../src/services/pdf/layouts/layoutVerification.js';
import { assertLayoutLayerCompatibility } from '../../../../src/services/pdf/layouts/layoutConfig.js';

describe('PDF layout packs', () => {
  it('resolves a frozen, fingerprinted reading layout', () => {
    const layout = resolvePdfLayout({ pdf: { layoutPreset: 'reading-5x8' } });
    expect(layout.id).toBe('reading-5x8');
    expect(layout.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.page.margins)).toBe(true);
    expect(resolvePdfLayout({ pdf: {} })).toBeNull();
  });

  it('rejects unknown, duplicate, and open-ended pack definitions', () => {
    expect(() => resolvePdfLayout({ pdf: { layoutPreset: 'missing' } })).toThrow(
      'Unknown PDF layout preset'
    );
    expect(() => new LayoutRegistry([reading5x8, reading5x8])).toThrow('Duplicate PDF layout pack');
    const invalid = structuredClone(reading5x8);
    invalid.rawLatex = '\\usepackage{unsafe}';
    expect(() => new LayoutRegistry([invalid])).toThrow('rawLatex');
    const impossible = structuredClone(reading5x8);
    impossible.page.margins.left = '3in';
    impossible.page.margins.right = '3in';
    expect(() => new LayoutRegistry([impossible])).toThrow('positive body area');
  });

  it('creates stable fingerprints that change with the spec', () => {
    const first = new LayoutRegistry([structuredClone(reading5x8)]).resolve('reading-5x8');
    const second = new LayoutRegistry([structuredClone(reading5x8)]).resolve('reading-5x8');
    const changedPack = structuredClone(reading5x8);
    changedPack.version = '1.0.1';
    const changed = new LayoutRegistry([changedPack]).resolve('reading-5x8');
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it('translates the closed spec into Pandoc variables, geometry, and trusted header rules', () => {
    const layout = resolvePdfLayout({ pdf: { layoutPreset: 'reading-5x8' } });
    const adapter = new PandocLayoutAdapter(layout);
    expect(adapter.getGeometryVariable()).toBe(
      'geometry:paperwidth=5in,paperheight=8in,top=0.65in,right=0.5in,bottom=0.65in,left=0.5in,headheight=10pt,headsep=8pt,footskip=24pt'
    );
    expect(adapter.getPandocVariables()).toEqual(expect.arrayContaining([
      'documentclass=scrartcl',
      'classoption=fontsize=10.5pt',
      'classoption=oneside',
      'linestretch=1.25',
      'mainfont=Noto Serif CJK SC',
      'sansfont=Noto Sans CJK SC',
      'monofont=DejaVu Sans Mono',
    ]));
    const header = adapter.composeHeader('% base');
    expect(header).toContain('PunctStyle=kaiming');
    expect(header).toContain('scrlayer-scrpage');
    expect(header).toContain('seqsplit');
    expect(header).toContain('truncate{28em}');
    expect(header).toContain('\\widowpenalty=8000');
    expect(header).not.toContain('fancyhdr');
  });

  it('derives renderer verification facts from the same layout', () => {
    const expectations = getLayoutVerificationExpectations(
      resolvePdfLayout({ pdf: { layoutPreset: 'reading-5x8' } })
    );
    expect(expectations.pageWidthPt).toBe(360);
    expect(expectations.pageHeightPt).toBe(576);
    expect(expectations.marginLeftPt).toBe(36);
    expect(expectations.marginTopPt).toBeCloseTo(46.8);
    expect(expectations.requiredFonts).toContainEqual(expect.objectContaining({
      name: 'Noto Serif CJK SC',
    }));
    expect(expectations.layout.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('shadows lower layout fields atomically and rejects same-or-higher-layer conflicts', () => {
    const selection = assertLayoutLayerCompatibility([
      { name: 'base', config: { markdownPdf: { pdfOptions: { format: 'A4', margin: '20mm' } } } },
      { name: 'profile', config: { pdf: { layoutPreset: 'reading-5x8' } } },
    ]);
    expect(selection).toEqual({ preset: 'reading-5x8', source: 'profile', sourceIndex: 1 });
    expect(() => assertLayoutLayerCompatibility([
      { name: 'base', config: { pdf: { layoutPreset: 'reading-5x8' } } },
      { name: 'target', config: { pdf: { margin: 'normal' } } },
    ])).toThrow('pdf.margin');
    expect(() => assertLayoutLayerCompatibility([
      { name: 'profile', config: {
        pdf: { layoutPreset: 'reading-5x8', fontSize: '16px' },
      } },
    ])).toThrow('pdf.fontSize');
  });
});
