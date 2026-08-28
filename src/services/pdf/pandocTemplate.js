import { fileURLToPath } from 'node:url';

const symbolFontDirectory = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));

// Shared typography for single-article and batch PDFs. Symbols use a bundled,
// explicitly selected font; unsupported characters remain verification errors.
export const pandocHeader = String.raw`\usepackage{fvextra}
\setmonofont{DejaVuSansMono}[Scale=MatchLowercase,BoldFont=DejaVuSansMono-Bold,ItalicFont=DejaVuSansMono-Oblique,BoldItalicFont=DejaVuSansMono-BoldOblique]
\newfontfamily\scraperSymbols{DocumentationSymbols.ttf}[Path={${symbolFontDirectory}}]
\newfontfamily\scraperIPA{DejaVu Sans}
\usepackage{newunicodechar}
\newunicodechar{⏸}{{\scraperSymbols\char"23F8}}
\newunicodechar{✅}{{\scraperSymbols\char"2705}}
\newunicodechar{❌}{{\scraperSymbols\char"274C}}
\newunicodechar{📊}{{\scraperSymbols\char"1F4CA}}
\newunicodechar{📁}{{\scraperSymbols\char"1F4C1}}
% The pinned en-US pronunciation dictionary uses this complete IPA symbol set.
% Keep body typography unchanged and route only those glyphs to a portable font.
\newunicodechar{æ}{{\scraperIPA æ}}
\newunicodechar{ð}{{\scraperIPA ð}}
\newunicodechar{ŋ}{{\scraperIPA ŋ}}
\newunicodechar{ɑ}{{\scraperIPA ɑ}}
\newunicodechar{ɔ}{{\scraperIPA ɔ}}
\newunicodechar{ə}{{\scraperIPA ə}}
\newunicodechar{ɛ}{{\scraperIPA ɛ}}
\newunicodechar{ɝ}{{\scraperIPA ɝ}}
\newunicodechar{ɡ}{{\scraperIPA ɡ}}
\newunicodechar{ɪ}{{\scraperIPA ɪ}}
\newunicodechar{ɫ}{{\scraperIPA ɫ}}
\newunicodechar{ɹ}{{\scraperIPA ɹ}}
\newunicodechar{ʃ}{{\scraperIPA ʃ}}
\newunicodechar{ʊ}{{\scraperIPA ʊ}}
\newunicodechar{ʒ}{{\scraperIPA ʒ}}
\newunicodechar{ˈ}{{\scraperIPA ˈ}}
\newunicodechar{ˌ}{{\scraperIPA ˌ}}
\newunicodechar{θ}{{\scraperIPA θ}}
\fvset{codes*={\catcode"23F8=\active\catcode"2705=\active\catcode"274C=\active\catcode"1F4CA=\active\catcode"1F4C1=\active}}
\RecustomVerbatimEnvironment{verbatim}{Verbatim}{breaklines,breakanywhere,fontsize=\small}
\DefineVerbatimEnvironment{Highlighting}{Verbatim}{breaklines,breakanywhere,fontsize=\small,commandchars=\\\{\}}
\usepackage{xurl}
\usepackage{microtype}
\microtypesetup{protrusion=false}
% KOMA's large default footskip can place page labels outside a 1cm margin.
\setlength{\footskip}{12pt}
\setlength{\emergencystretch}{3em}
\usepackage{tocloft}
\setlength{\cftbeforesecskip}{0.55em}
\setlength{\cftbeforesubsecskip}{0.18em}
\setlength{\cftbeforesubsubsecskip}{0.08em}
\setlength{\cftsecindent}{0em}
\setlength{\cftsubsecindent}{1.5em}
\setlength{\cftsubsubsecindent}{3.0em}
\setlength{\cftsecnumwidth}{0em}
\setlength{\cftsubsecnumwidth}{0em}
\setlength{\cftsubsubsecnumwidth}{0em}
\cftsetpnumwidth{2.6em}
\cftsetrmarg{3.6em}
\renewcommand{\cftdotsep}{1.5}
\renewcommand{\cftsecleader}{\cftdotfill{\cftdotsep}}
\renewcommand{\cftsecfont}{\large\bfseries}
\renewcommand{\cftsubsecfont}{\bfseries}
\renewcommand{\cftsubsubsecfont}{\small}
\renewcommand{\cftsecpagefont}{\bfseries}
\renewcommand{\cftsubsubsecpagefont}{\small}
\usepackage{needspace}
\PassOptionsToPackage{pdfpagelabels=true}{hyperref}
\makeatletter
\AddToHook{begindocument/end}{%
  \let\scraperTableOfContents\tableofcontents
  \renewcommand{\tableofcontents}{%
    \pagenumbering{roman}%
    \scraperTableOfContents
    \clearpage\pagenumbering{arabic}%
  }%
  \let\scraperSectionTocLine\l@section
  \renewcommand{\l@section}{\Needspace{4\baselineskip}\scraperSectionTocLine}%
  \let\scraperSubsectionTocLine\l@subsection
  \renewcommand{\l@subsection}{\Needspace{3\baselineskip}\scraperSubsectionTocLine}%
}
\@ifclassloaded{scrartcl}{%
  \RedeclareSectionCommand[runin=false,beforeskip=1.5ex plus 0.5ex minus 0.2ex,afterskip=0.6ex]{paragraph}
  \RedeclareSectionCommand[runin=false,beforeskip=1.2ex plus 0.4ex minus 0.2ex,afterskip=0.5ex]{subparagraph}
}{%
  \usepackage{titlesec}
  \titleformat{\paragraph}[block]{\normalsize\bfseries}{}{0pt}{}
  \titlespacing*{\paragraph}{0pt}{1.5ex plus 0.5ex minus 0.2ex}{0.6ex}
  \titleformat{\subparagraph}[block]{\normalsize\bfseries}{}{0pt}{}
  \titlespacing*{\subparagraph}{0pt}{1.2ex plus 0.4ex minus 0.2ex}{0.5ex}
}
\makeatother
\let\scraperTexttt\texttt
\renewcommand{\texttt}[1]{{\small\scraperTexttt{#1}}}
`;
