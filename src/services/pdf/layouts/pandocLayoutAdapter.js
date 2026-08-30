import { ValidationError } from '../../../utils/errors.js';

function decimal(value) {
  return Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function fontSize(size, leading = 1.2) {
  return `\\fontsize{${decimal(size)}pt}{${decimal(size * leading)}pt}\\selectfont`;
}

export class PandocLayoutAdapter {
  constructor(layout) {
    if (layout?.renderer !== 'pandoc-xelatex') {
      throw new ValidationError(`Unsupported PDF layout renderer: ${layout?.renderer || 'missing'}`);
    }
    this.layout = layout;
  }

  getPandocVariables() {
    const { typography } = this.layout;
    return [
      'documentclass=scrartcl',
      `classoption=fontsize=${decimal(typography.fontSizePt)}pt`,
      `classoption=${this.layout.page.duplex ? 'twoside' : 'oneside'}`,
      `linestretch=${decimal(typography.lineHeight / 1.2)}`,
      `mainfont=${typography.bodyFont}`,
      `sansfont=${typography.headingFont}`,
      `CJKsansfont=${typography.headingFont}`,
      `monofont=${typography.monoFont}`,
    ];
  }

  getGeometryVariable() {
    const { page, furniture } = this.layout;
    const geometry = [
      `paperwidth=${page.width}`,
      `paperheight=${page.height}`,
      `top=${page.margins.top}`,
      `right=${page.margins.right}`,
      `bottom=${page.margins.bottom}`,
      `left=${page.margins.left}`,
      `headheight=${furniture.headHeight}`,
      `headsep=${furniture.headSep}`,
      `footskip=${furniture.footSkip}`,
    ];
    return `geometry:${geometry.join(',')}`;
  }

  composeHeader(baseHeader) {
    const { typography, paragraphs, pagination, furniture, content } = this.layout;
    const keepSpace = `${pagination.headingKeepLines}\\baselineskip`;
    const codeBreaks = content.wrapCode ? ',breaklines,breakanywhere' : '';
    const bottomMode = pagination.raggedBottom ? '\\raggedbottom' : '\\flushbottom';
    const layoutHeader = String.raw`
% Layout Pack: ${this.layout.id}@${this.layout.version} (${this.layout.fingerprint})
\usepackage[automark]{scrlayer-scrpage}
\usepackage[fit]{truncate}
\usepackage{seqsplit}
\setlength{\headheight}{${furniture.headHeight}}
\setlength{\headsep}{${furniture.headSep}}
\setlength{\footskip}{${furniture.footSkip}}
\clearpairofpagestyles
\automark{section}
\setkomafont{pageheadfoot}{\normalfont\sffamily ${fontSize(typography.runningHeaderSizePt)}}
\setkomafont{pagenumber}{\normalfont\sffamily ${fontSize(typography.runningHeaderSizePt)}}
\ihead[]{\truncate{${decimal(furniture.maxMarkEm)}em}{\headmark}}
\ohead[]{\pagemark}
\cfoot[\pagemark]{}
\pagestyle{scrheadings}
\setkomafont{disposition}{\sffamily\bfseries}
\setkomafont{section}{${fontSize(typography.headingSizesPt.h1)}}
\setkomafont{subsection}{${fontSize(typography.headingSizesPt.h2)}}
\setkomafont{subsubsection}{${fontSize(typography.headingSizesPt.h3)}}
\setlength{\parindent}{${decimal(paragraphs.firstLineIndentEm)}em}
\setlength{\parskip}{${decimal(paragraphs.spacingEm)}em plus .1em minus .1em}
\widowpenalty=${pagination.widowPenalty}
\clubpenalty=${pagination.orphanPenalty}
\displaywidowpenalty=${pagination.displayWidowPenalty}
${bottomMode}
\AtBeginDocument{\xeCJKsetup{PunctStyle=${typography.punctuationStyle}}}
\AddToHook{cmd/section/before}{\Needspace{${keepSpace}}\thispagestyle{plain.scrheadings}}
\AddToHook{cmd/subsection/before}{%
  \Needspace{${keepSpace}}%
  \ifdim\pagetotal<2\baselineskip\vspace*{${furniture.openingLines}\baselineskip}\fi%
  \thispagestyle{plain.scrheadings}%
}
\RecustomVerbatimEnvironment{verbatim}{Verbatim}{fontsize=${fontSize(content.codeFontSizePt, 1.25)}${codeBreaks}}
\RecustomVerbatimEnvironment{Highlighting}{Verbatim}{fontsize=${fontSize(content.codeFontSizePt, 1.25)}${codeBreaks},commandchars=\\\{\}}
\renewcommand{\texttt}[1]{{${fontSize(content.codeFontSizePt, 1.25)}\scraperTexttt{\seqsplit{#1}}}}
`;
    return `${baseHeader.trimEnd()}\n${layoutHeader}`;
  }
}
