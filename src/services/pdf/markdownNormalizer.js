import path from 'node:path';
import { ValidationError } from '../../utils/errors.js';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mapMarkdownProse } from '../../utils/markdownSegments.js';

/** Content normalization only; no filesystem, network or renderer lifecycle. */
export class MarkdownNormalizer {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Strip all MDX constructs from content using AST-based parsing for maximum
   * reliability. Handles:
   * - `mdxjsEsm`: module-level `export`/`import` declarations
   * - `mdxJsxFlowElement`/`mdxJsxTextElement`: JSX components
   *   - Known components are transformed (Info→blockquote, Step→header, etc.)
   *   - Unknown PascalCase components have tags stripped, children preserved
   *   - HTML elements (lowercase) are preserved
   * - `mdxFlowExpression`/`mdxTextExpression`: `{expression}` blocks
   *
   * Invalid MDX is reported to the caller; no alternate parser is used.
   *
   * @param {string} content
   * @returns {string}
   * @private
   */
  _stripMdxWithAst(content, pageUrl) {
    if (!content) return content;

    try {
      const tree = fromMarkdown(content, {
        extensions: [mdxjs()],
        mdastExtensions: [mdxFromMarkdown()],
      });

      const edits = [];

      const getAttr = (node, attrName) => {
        const attr = node.attributes?.find((a) => a.name === attrName);
        if (!attr) return '';
        if (typeof attr.value === 'string') return attr.value;
        if (attr.value?.data?.estree) return this._staticMdxExpression(attr.value, content);
        return '';
      };

      const collectEdits = (node) => {
        if (node.type === 'mdxjsEsm') {
          edits.push([node.position.start.offset, node.position.end.offset, '']);
          return;
        }

        if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
          edits.push([node.position.start.offset, node.position.end.offset, this._staticMdxExpression(node, content)]);
          return;
        }

        if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
          const name = node.name;
          const start = node.position.start.offset;
          const end = node.position.end.offset;

          // Lowercase/null → HTML element, recurse into children only
          if (!name || name[0] < 'A' || name[0] > 'Z') {
            if (name === 'img') {
              const classes = (getAttr(node, 'className') || getAttr(node, 'class')).split(/\s+/);
              const theme = this.config.pdf?.theme || 'light';
              const hiddenForTheme = theme === 'dark'
                ? classes.includes('dark:hidden')
                : classes.includes('hidden') && classes.some((value) => /^dark:(block|inline|flex)$/.test(value));
              if (hiddenForTheme) {
                edits.push([start, end, '']);
                return;
              }
            }
            if (node.children) node.children.forEach(collectEdits);
            return;
          }

          // Extract and recursively process inner content
          let innerContent = '';
          if (node.children?.length > 0) {
            const innerStart = node.children[0].position.start.offset;
            const innerEnd = node.children[node.children.length - 1].position.end.offset;
            innerContent = content.slice(innerStart, innerEnd);

            // Restore the first line's wrapper indentation before removing the
            // common indent, so nested code indentation remains meaningful.
            const lineStart = content.lastIndexOf('\n', innerStart - 1) + 1;
            const linePrefix = content.slice(lineStart, innerStart);
            if (/^[ \t]*$/.test(linePrefix)) {
              const lines = (linePrefix + innerContent).split('\n');
              const nonBlankLines = lines.filter((line) => line.trim());
              const indent = Math.min(...nonBlankLines.map((line) => line.match(/^[ \t]*/)[0].length));
              innerContent = lines.map((line) => line.slice(indent)).join('\n');
            }
            innerContent = this._stripMdxWithAst(innerContent, pageUrl);
          }

          let replacement;
          switch (name) {
            case 'Steps':
            case 'Tabs':
            case 'AccordionGroup':
            case 'CardGroup':
              replacement = innerContent;
              break;
            case 'Card': {
              const title = getAttr(node, 'title');
              const target = getAttr(node, 'href');
              const href = target && pageUrl ? new URL(target, pageUrl).href : target;
              const label = title.replace(/[\\[\]]/g, '\\$&');
              if (!title && !innerContent.trim()) throw new Error('Card has no static title or body');
              const heading = href ? `[${label || href}](${href.replace(/[\s()]/g, encodeURIComponent)})` : label;
              replacement = `\n${heading ? `**${heading}**\n\n` : ''}${innerContent}\n`;
              break;
            }
            case 'Step': {
              const title = getAttr(node, 'title');
              replacement = title ? `\n### ${title}\n\n${innerContent}\n` : `\n${innerContent}\n`;
              break;
            }
            case 'Tab': {
              const title = getAttr(node, 'title');
              replacement = title ? `\n#### ${title}\n\n${innerContent}\n` : `\n${innerContent}\n`;
              break;
            }
            case 'Accordion': {
              const title = getAttr(node, 'title');
              replacement = title ? `\n#### ${title}\n\n${innerContent}\n` : `\n${innerContent}\n`;
              break;
            }
            case 'Info':
            case 'Tip':
            case 'Warning':
            case 'Note': {
              const label = name === 'Tip' ? 'Tip' : name === 'Warning' ? 'Warning' : 'Note';
              replacement = this._contentToBlockquote(innerContent, label);
              break;
            }
            default:
              if (!innerContent.trim()) {
                throw new Error(`Unsupported empty MDX component <${name}> at line ${node.position.start.line}; provide static content`);
              }
              replacement = innerContent;
              break;
          }

          edits.push([start, end, replacement]);
          return;
        }

        // For all other node types, recurse into children
        if (node.children) node.children.forEach(collectEdits);
      };

      collectEdits(tree);

      // Sort by start offset descending, apply from end to start
      edits.sort((a, b) => b[0] - a[0]);

      let result = content;
      for (const [s, e, replacement] of edits) {
        result = result.slice(0, s) + replacement + result.slice(e);
      }

      return result;
    } catch (error) {
      throw new ValidationError(`Invalid MDX source: ${error.message}`);
    }
  }

  _staticMdxExpression(node) {
    const statements = node.data?.estree?.body || [];
    if (statements.length === 0) return ''; // MDX comments have no rendered value.
    const expression = statements.length === 1 && statements[0].expression;
    if (expression?.type === 'Literal') {
      if (expression.value == null || typeof expression.value === 'boolean') return '';
      if (['number', 'string'].includes(typeof expression.value)) return String(expression.value);
    }
    if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) {
      return expression.quasis[0].value.cooked;
    }
    if (expression?.type === 'UnaryExpression' && ['-', '+'].includes(expression.operator)
        && expression.argument.type === 'Literal' && typeof expression.argument.value === 'number') {
      return String(expression.operator === '-' ? -expression.argument.value : expression.argument.value);
    }
    throw new Error(`Unsupported dynamic MDX expression at line ${node.position?.start.line ?? '?'}; provide static content`);
  }

  /**
   * Convert text content to a markdown blockquote with a label.
   *
   * @param {string} innerContent
   * @param {string} label
   * @returns {string}
   * @private
   */
  _contentToBlockquote(innerContent, label) {
    if (!innerContent?.trim()) return '';

    const lines = innerContent.split('\n');
    while (lines.length > 0 && !lines[0].trim()) lines.shift();
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();

    const quotedLines = [`> **${label}:**`, '>'];
    for (const line of lines) {
      quotedLines.push(line.trim() ? `> ${line.trimEnd()}` : '>');
    }
    return '\n' + quotedLines.join('\n') + '\n';
  }

  /**
   * Disable syntax highlighting for code blocks containing lines too wide for
   * Pandoc's token macros to break. Plain verbatim blocks still preserve the
   * code exactly and are wrapped by fvextra in the generated PDF.
   *
   * @param {string} content
   * @returns {string}
   * @private
   */
  _disableHighlightingForLongCodeBlocks(content) {
    const maxLineLength = this.config.pdf?.maxCodeLineLength || 100;

    return this._splitFencedCodeBlockSegments(content)
      .map((segment) => {
        if (segment.type !== 'code') return segment.text;

        const lines = segment.text.split('\n');
        if (lines.length < 3) return segment.text;

        const opening = lines[0].match(/^(\s*>?\s*)(`{3,}|~{3,})(.*)$/);
        if (!opening || !opening[3].trim()) return segment.text;

        const bodyLines = lines.slice(1, -1);
        const hasUnsafeLine = bodyLines.some(
          (line) => line.replace(/^\s*>\s?/, '').length > maxLineLength
        );
        if (!hasUnsafeLine) return segment.text;

        lines[0] = `${opening[1]}${opening[2]}`;
        return lines.join('\n');
      })
      .join('\n');
  }

  /**
   * Split markdown into prose/code segments so fenced code block examples can
   * be preserved verbatim during prose-only rewrites.
   *
   * @param {string} content
   * @returns {{type: 'prose' | 'code', text: string}[]}
   * @private
   */
  _splitFencedCodeBlockSegments(content) {
    if (typeof content !== 'string' || content.length === 0) {
      return [];
    }

    const lines = content.split('\n');
    const segments = [];
    let buffer = [];
    let currentType = 'prose';
    let inFence = false;
    let fenceChar = '';
    let fenceCount = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      segments.push({ type: currentType, text: buffer.join('\n') });
      buffer = [];
    };

    for (const line of lines) {
      const fenceMatch = line.match(/^(?:[ \t]*>[ \t]*)*[ \t]*(`{3,}|~{3,})(.*)$/);

      if (!inFence && fenceMatch) {
        flush();
        inFence = true;
        currentType = 'code';
        fenceChar = fenceMatch[1][0];
        fenceCount = fenceMatch[1].length;
        buffer.push(line);
        continue;
      }

      if (
        inFence &&
        fenceMatch &&
        fenceMatch[1][0] === fenceChar &&
        fenceMatch[1].length >= fenceCount &&
        fenceMatch[2].trim() === ''
      ) {
        buffer.push(line);
        flush();
        inFence = false;
        currentType = 'prose';
        fenceChar = '';
        fenceCount = 0;
        continue;
      }

      buffer.push(line);
    }

    flush();
    return segments;
  }

  /**
   * Apply a transform only to prose segments outside fenced code blocks.
   *
   * @param {string} content
   * @param {(segment: string) => string} transform
   * @returns {string}
   * @private
   */
  _mapProseSegments(content, transform) {
    return mapMarkdownProse(content, transform);
  }

  /**
   * Find the closing `]` for an image alt text while honoring nested brackets
   * and backslash escapes.
   *
   * @param {string} content
   * @param {number} openBracketIndex
   * @returns {number}
   * @private
   */
  _findClosingMarkdownBracket(content, openBracketIndex) {
    let depth = 1;

    for (let i = openBracketIndex + 1; i < content.length; i++) {
      if (content[i] === '\\') {
        i++;
        continue;
      }

      if (content[i] === '[') {
        depth++;
      } else if (content[i] === ']') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * Parse the destination/title portion of `![alt](...)` without greedily
   * swallowing optional title text.
   *
   * @param {string} content
   * @param {number} openParenIndex
   * @returns {{end: number, url: string, destinationSource: string, titleSource: string}|null}
   * @private
   */
  _parseMarkdownImageTarget(content, openParenIndex) {
    let i = openParenIndex + 1;
    let depth = 1;
    let inQuote = '';
    let inAngle = false;

    while (i < content.length) {
      const char = content[i];

      if (char === '\\') {
        i += 2;
        continue;
      }

      if (inQuote) {
        if (char === inQuote) {
          inQuote = '';
        }
        i++;
        continue;
      }

      if (inAngle) {
        if (char === '>') {
          inAngle = false;
        }
        i++;
        continue;
      }

      if (char === '<') {
        inAngle = true;
      } else if (char === '"' || char === "'") {
        inQuote = char;
      } else if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          break;
        }
      }

      i++;
    }

    if (depth !== 0) {
      return null;
    }

    const inner = content.slice(openParenIndex + 1, i);
    const parsed = this._parseMarkdownImageTargetBody(inner);
    if (!parsed?.url) {
      return null;
    }

    return { end: i, ...parsed };
  }

  /**
   * Parse the inside of `![alt](...)` into destination and optional title.
   *
   * @param {string} targetBody
   * @returns {{url: string, destinationSource: string, titleSource: string}|null}
   * @private
   */
  _parseMarkdownImageTargetBody(targetBody) {
    let i = 0;

    while (i < targetBody.length && /\s/.test(targetBody[i])) {
      i++;
    }

    if (i >= targetBody.length) {
      return null;
    }

    const destinationStart = i;
    let destinationSource;
    let url;

    if (targetBody[i] === '<') {
      i++;
      const urlStart = i;

      while (i < targetBody.length) {
        if (targetBody[i] === '\\') {
          i += 2;
          continue;
        }
        if (targetBody[i] === '>') {
          break;
        }
        i++;
      }

      if (i >= targetBody.length || targetBody[i] !== '>') {
        return null;
      }

      destinationSource = targetBody.slice(destinationStart, i + 1);
      url = targetBody.slice(urlStart, i);
      i++;
    } else {
      let parenDepth = 0;

      while (i < targetBody.length) {
        const char = targetBody[i];

        if (char === '\\') {
          i += 2;
          continue;
        }

        if (/\s/.test(char) && parenDepth === 0) {
          break;
        }

        if (char === '(') {
          parenDepth++;
        } else if (char === ')' && parenDepth > 0) {
          parenDepth--;
        }

        i++;
      }

      destinationSource = targetBody.slice(destinationStart, i);
      url = destinationSource.trim();
    }

    if (!url) {
      return null;
    }

    const remainder = targetBody.slice(i).trim();
    if (!remainder) {
      return { url, destinationSource, titleSource: '' };
    }

    const titleSource = this._parseMarkdownTitleSource(remainder);
    return { url, destinationSource, titleSource };
  }

  /**
   * Parse a valid markdown title suffix (`"..."`, `'...'`, or `(...)`).
   *
   * @param {string} remainder
   * @returns {string}
   * @private
   */
  _parseMarkdownTitleSource(remainder) {
    const opener = remainder[0];
    const closer = opener === '(' ? ')' : opener === '"' ? '"' : opener === "'" ? "'" : '';

    if (!closer) {
      return '';
    }

    let i = 1;
    while (i < remainder.length) {
      if (remainder[i] === '\\') {
        i += 2;
        continue;
      }

      if (remainder[i] === closer) {
        return remainder.slice(i + 1).trim() === '' ? remainder.slice(0, i + 1) : '';
      }

      i++;
    }

    return '';
  }

  /**
   * Collect markdown image references from prose content.
   *
   * @param {string} content
   * @returns {Array<{type: 'markdown', start: number, end: number, altText: string, url: string, destinationSource: string, titleSource: string}>}
   * @private
   */
  _collectMarkdownImageReferences(content) {
    if (!content) return [];

    const references = [];

    for (let i = 0; i < content.length - 1; i++) {
      if (content[i] !== '!' || content[i + 1] !== '[') {
        continue;
      }

      const altOpenIndex = i + 1;
      const altCloseIndex = this._findClosingMarkdownBracket(content, altOpenIndex);
      if (altCloseIndex === -1 || content[altCloseIndex + 1] !== '(') {
        continue;
      }

      const parsedTarget = this._parseMarkdownImageTarget(content, altCloseIndex + 1);
      if (!parsedTarget) {
        continue;
      }

      references.push({
        type: 'markdown',
        start: i,
        end: parsedTarget.end + 1,
        altText: content.slice(i + 2, altCloseIndex),
        url: parsedTarget.url,
        destinationSource: parsedTarget.destinationSource,
        titleSource: parsedTarget.titleSource,
      });

      i = parsedTarget.end;
    }

    return references;
  }

  /**
   * Collect raw HTML <img> references from prose content.
   *
   * @param {string} content
   * @returns {Array<{type: 'html', start: number, end: number, altText: string, url: string}>}
   * @private
   */
  _collectHtmlImageReferences(content) {
    if (!content) return [];

    const references = [];

    for (const match of content.matchAll(/<img\b([^>]*?)src=(["'])([^"']+)\2([^>]*)>/gi)) {
      const start = match.index ?? 0;
      const attrs = `${match[1]} ${match[4]}`;
      const altMatch = attrs.match(/\balt=(["'])(.*?)\1/i);

      references.push({
        type: 'html',
        start,
        end: start + match[0].length,
        altText: altMatch?.[2]?.trim() || 'Image',
        url: match[3],
      });
    }

    return references;
  }

  /**
   * Collect remote image references from prose content only.
   *
   * @param {string} content
   * @returns {Array}
   * @private
   */
  _collectRemoteImageReferencesFromProse(content) {
    return [
      ...this._collectMarkdownImageReferences(content),
      ...this._collectHtmlImageReferences(content),
    ].filter((reference) => this._isRemoteImageUrl(reference.url));
  }

  /**
   * Rewrite remote image references in prose while preserving fenced code
   * blocks verbatim.
   *
   * @param {string} content
   * @param {Map<string, string|null>} resolvedUrls
   * @returns {string}
   * @private
   */
  _rewritePdfImagesInProse(content, resolvedUrls) {
    const references = this._collectRemoteImageReferencesFromProse(content);
    if (references.length === 0) {
      return content;
    }

    let rewritten = content;

    references
      .sort((a, b) => b.start - a.start)
      .forEach((reference) => {
        const localPath = resolvedUrls.get(reference.url);
        if (!localPath) throw new ValidationError(`Unresolved PDF image: ${reference.url}`);
        const replacement = reference.type === 'markdown'
          ? `![${reference.altText}](${localPath}${reference.titleSource ? ` ${reference.titleSource}` : ''})`
          : `![${reference.altText}](${localPath})`;

        rewritten = rewritten.slice(0, reference.start) + replacement + rewritten.slice(reference.end);
      });

    return rewritten;
  }

  /**
   * 提取内容中所有需要额外转换的图片 URL。
   *
   * @param {string} content
   * @returns {string[]}
   * @private
   */
  _extractPdfUnsafeImageUrls(content) {
    if (!content) return [];

    const urls = new Set();

    for (const segment of this._splitFencedCodeBlockSegments(content)) {
      if (segment.type !== 'prose') {
        continue;
      }

      for (const reference of this._collectRemoteImageReferencesFromProse(segment.text)) {
        urls.add(reference.url);
      }
    }

    return Array.from(urls);
  }

  /**
   * 判断是否为远程图片 URL。
   *
   * @param {string} url
   * @returns {boolean}
   * @private
   */
  _isRemoteImageUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
  }

  /**
   * 清理 Markdown 内容，修复 Pandoc 不支持的语法
   * @param {string} content
   * @returns {string}
   * @private
   */
  _cleanMarkdownContent(content, pageUrl) {
    if (!content) return content;

    // Markdown and MDX have different grammars; choose explicitly, never retry a parser.
    let cleaned = this.config.markdownSource?.format === 'mdx'
      ? this._stripMdxWithAst(content, pageUrl) : content;

    // Only normalize the outer fence header, never examples inside its body.
    cleaned = this._splitFencedCodeBlockSegments(cleaned).map((segment) => {
      if (segment.type !== 'code') return segment.text;
      const lines = segment.text.split('\n');
      lines[0] = lines[0].replace(
        /^([ \t]*(?:>[ \t]*)*)(`{3,}|~{3,})([\w-]+)([^\n]*)$/,
        (match, prefix, fence, lang, rest) => {
          if (!rest.trim()) return match;
          const attrs = rest.trim().match(/^(\{[^}]*\})$/);
          return `${prefix}${fence}${lang}${attrs ? ` ${attrs[1]}` : ''}`;
        }
      );
      return lines.join('\n');
    }).join('\n');

    cleaned = this._disableHighlightingForLongCodeBlocks(cleaned);

    return this._mapProseSegments(cleaned, (segment) => this._cleanProse(segment));
  }

  _cleanProse(content) {
    // Wrapper indentation is removed by the MDX AST transform. Markdown list
    // and indented-code whitespace must not be globally dedented here.
    let cleaned = content.replace(
      /(^[^|\n\r].*(?:\r?\n|\r))(\|.*\|.*(?:\r?\n|\r)\|[-: ]+\|)/gm,
      '$1\n$2'
    );
    // Authored prose filenames can use escaped underscores without backticks.
    // Permit breaks after the visible underscore; never alter code examples.
    cleaned = mapMarkdownProse(cleaned, (segment) => segment.replace(/\\_/g, '\\_\\allowbreak{}'), { inlineCode: true });

    // 3. 规范化表格分隔符行，防止某一列过宽导致其他列被压缩 (修复表格重叠问题)
    // 查找类似 | --- | :--- | ---: | 的行
    cleaned = cleaned.replace(/^\|?(\s*:?-+:?\s*\|)+$/gm, (match) => {
      // 如果不是表格分隔线（防止误判），直接返回
      if (!match.includes('-')) return match;

      return match.replace(/:?-+:?/g, (dashes) => {
        // 保留对齐冒号
        const hasLeftColon = dashes.startsWith(':');
        const hasRightColon = dashes.endsWith(':');

        let dashCount = dashes.length - (hasLeftColon ? 1 : 0) - (hasRightColon ? 1 : 0);

        // 限制 dash 数量在 10 到 50 之间
        // 既保证最小宽度，又防止某一列过度占用
        let newCount = Math.max(10, Math.min(dashCount, 50));

        return (hasLeftColon ? ':' : '') + '-'.repeat(newCount) + (hasRightColon ? ':' : '');
      });
    });

    cleaned = this._normalizeReferenceCardBlocks(cleaned);
    cleaned = this._formatFieldReferenceTablesForPdf(cleaned);
    cleaned = this._formatReferenceTablesForPdf(cleaned);
    cleaned = this._formatMetricCatalogTablesForPdf(cleaned);
    cleaned = this._formatSandboxApprovalTablesForPdf(cleaned);

    // 4. 修复 blockquote 中的列表项（防止 LaTeX \end{quote} / missing \item 错误）
    // 4a. Remove empty list items inside blockquotes: "> -" or "> *" with no content
    cleaned = cleaned.replace(/^(>\s*)-\s*$/gm, '$1');
    cleaned = cleaned.replace(/^(>\s*)\*\s*$/gm, '$1');

    // 4b. Ensure a blank line between blockquote prose and blockquote list items
    // e.g. "> text\n> - item" -> "> text\n>\n> - item"
    cleaned = cleaned.replace(/^(>(?!\s*[-*]\s).+\S)\n(>\s*[-*]\s+\S)/gm, '$1\n>\n$2');

    // 4c. Convert ATX headings inside blockquotes to bold text.
    // Pandoc 3.9+ inserts `\mbox{}%` before `\subsection` inside `\begin{quote}`,
    // but older Pandoc (e.g. Ubuntu 24.04 ships 3.1.x) does not, which causes
    // `LaTeX Error: Something's wrong--perhaps a missing \item` at `\end{quote}`.
    // Bold preserves visual emphasis without triggering quote+section nesting.
    //
    // Fence-aware: skip lines inside fenced code blocks (with optional `> `
    // blockquote prefix) so markdown examples that show heading syntax inside
    // ` ``` ... ``` ` blocks are not corrupted. Closing fences must use the
    // same character (` or ~) and at least as many repetitions as the opener
    // (CommonMark spec).
    {
      const lines = cleaned.split('\n');
      let inFence = false;
      let fenceChar = '';
      let fenceCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const fenceMatch = lines[i].match(/^>?\s*(`{3,}|~{3,})/);
        if (fenceMatch) {
          const fc = fenceMatch[1][0];
          const fcCount = fenceMatch[1].length;
          if (!inFence) {
            inFence = true;
            fenceChar = fc;
            fenceCount = fcCount;
          } else if (fc === fenceChar && fcCount >= fenceCount) {
            inFence = false;
          }
          continue;
        }
        if (inFence) continue;
        lines[i] = lines[i].replace(/^(>\s*)#{1,6}\s+(.+?)\s*$/, '$1**$2**');
      }
      cleaned = lines.join('\n');
    }

    cleaned = this._constrainStandaloneIconImagesForPdf(cleaned);
    cleaned = this._constrainStandaloneRemoteImagesForPdf(cleaned);
    cleaned = this._formatStandaloneIconCardsForPdf(cleaned);
    cleaned = this._convertLongInlineCodeToBreakablePaths(cleaned);

    // Keep generated callout labels on the same page as the following content.
    cleaned = this._mapProseSegments(cleaned, (segment) =>
      segment.replace(
        /^(> \*\*(?:Note|Tip|Warning):\*\*)\n>\n/gm,
        '$1\n>\n> \\nopagebreak[4]\n>\n'
      )
    );

    return cleaned;
  }

  _formatStandaloneIconCardsForPdf(content) {
    return this._mapProseSegments(content, (segment) =>
      segment.replace(
        /(^|\n)(!\[[^\]\n]*\]\([^\n\r]*\)(?:\{[^}\n\r]*\})?)[ \t]*\n{2,}###[ \t]+([^\n\r]+)(?=\n|$)/g,
        (match, prefix, imageMarkdown, heading) => {
          const references = this._collectMarkdownImageReferences(imageMarkdown);
          if (references.length !== 1 || !this._isPdfIconImageUrl(references[0].url)) {
            return match;
          }

          return `${prefix}${imageMarkdown} **${heading.trim()}**`;
        }
      )
    );
  }

  _constrainStandaloneIconImagesForPdf(content) {
    return this._mapProseSegments(content, (segment) => {
      const references = this._collectMarkdownImageReferences(segment).filter((reference) =>
        this._shouldConstrainStandaloneIconImage(segment, reference)
      );

      if (references.length === 0) {
        return segment;
      }

      let result = segment;
      for (const reference of references.sort((a, b) => b.end - a.end)) {
        result = `${result.slice(0, reference.end)}{width=40px}${result.slice(reference.end)}`;
      }

      return result;
    });
  }

  _constrainStandaloneRemoteImagesForPdf(content) {
    return this._mapProseSegments(content, (segment) => {
      const references = this._collectMarkdownImageReferences(segment).filter((reference) =>
        this._shouldConstrainStandaloneRemoteImage(segment, reference)
      );

      if (references.length === 0) {
        return segment;
      }

      let result = segment;
      for (const reference of references.sort((a, b) => b.end - a.end)) {
        result = `${result.slice(0, reference.end)}{width=100%}${result.slice(reference.end)}`;
      }

      return result;
    });
  }

  _shouldConstrainStandaloneIconImage(content, reference) {
    if (!this._isPdfIconImageUrl(reference.url)) {
      return false;
    }

    if (this._hasMarkdownImageAttributesAfter(content, reference.end)) {
      return false;
    }

    return this._isStandaloneMarkdownReference(content, reference);
  }

  _shouldConstrainStandaloneRemoteImage(content, reference) {
    if (!this._isRemoteImageUrl(reference.url) || this._isPdfIconImageUrl(reference.url)) {
      return false;
    }

    if (this._hasMarkdownImageAttributesAfter(content, reference.end)) {
      return false;
    }

    return this._isStandaloneMarkdownReference(content, reference);
  }

  _isStandaloneMarkdownReference(content, reference) {
    const lineStart = content.lastIndexOf('\n', reference.start) + 1;
    const nextLineBreak = content.indexOf('\n', reference.end);
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;
    const before = content.slice(lineStart, reference.start).trim();
    const after = content.slice(reference.end, lineEnd).trim();

    return before === '' && after === '';
  }

  _hasMarkdownImageAttributesAfter(content, endIndex) {
    return /^[ \t]*\{[^}\n]*\}/.test(content.slice(endIndex));
  }

  _isPdfIconImageUrl(url) {
    if (!this._isRemoteImageUrl(url)) {
      return false;
    }

    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const filename = path.basename(pathname);
      return /(^|[-_])icon([-.]|$)/.test(filename);
    } catch {
      return false;
    }
  }

  _formatReferenceTablesForPdf(content) {
    const lines = String(content || '').split('\n');
    const output = [];

    for (let index = 0; index < lines.length; index++) {
      const headerCells = this._parseMarkdownTableRow(lines[index]);
      const separatorCells = this._parseMarkdownTableRow(lines[index + 1] || '');

      if (
        !this._isReferenceTableHeader(headerCells) ||
        !this._isMarkdownTableSeparator(separatorCells)
      ) {
        output.push(lines[index]);
        continue;
      }

      output.push(
        '| Key | Type / Values | Details |',
        '|:------------------------------------|:----------------------------|:----------------------------------------------------|'
      );
      index += 2;

      while (index < lines.length) {
        const rowCells = this._parseMarkdownTableRow(lines[index]);
        if (!rowCells || rowCells.length !== 3) {
          break;
        }

        const [key, typeValues, details] = rowCells;
        output.push(
          `| ${this._formatReferenceTableCell(key)} | ${this._formatReferenceTableCell(
            typeValues
          )} | ${this._formatReferenceTableCell(details)} |`
        );

        index++;
      }

      index--;
    }

    return output.join('\n');
  }

  _formatFieldReferenceTablesForPdf(content) {
    return this._mapProseSegments(String(content || ''), (segment) => {
      const lines = segment.split('\n');
      const output = [];

      for (let index = 0; index < lines.length; index++) {
        const headerCells = this._parseMarkdownTableRow(lines[index]);
        const separatorCells = this._parseMarkdownTableRow(lines[index + 1] || '');
        const normalizedHeader = headerCells?.map((cell) => cell.trim().toLowerCase());

        if (
          normalizedHeader?.join('|') !== 'field|required|description' ||
          !this._isMarkdownTableSeparator(separatorCells)
        ) {
          output.push(lines[index]);
          continue;
        }

        index += 2;
        while (index < lines.length) {
          const rowCells = this._parseMarkdownTableRow(lines[index]);
          if (!rowCells || rowCells.length !== 3) break;

          const [field, required, description] = rowCells;
          output.push(
            '',
            '\\Needspace{4\\baselineskip}',
            '',
            `**Field:** ${field} \\hfill{} **Required:** ${required}`,
            '',
            '\\nopagebreak[4]',
            '',
            description
          );
          index++;
        }

        index--;
      }

      return output.join('\n');
    });
  }

  _formatReferenceTableCell(cell) {
    return this._convertLongInlineCodeLineToBreakablePaths(
      this._normalizeMarkdownLinkSpacing(this._normalizeReferenceTableCell(cell))
    );
  }

  _normalizeMarkdownLinkSpacing(value) {
    return String(value || '').replace(/(\]\([^)]+\))(?=[A-Za-z0-9])/g, '$1 ');
  }

  _formatMetricCatalogTablesForPdf(content) {
    const lines = String(content || '').split('\n');
    const output = [];

    for (let index = 0; index < lines.length; index++) {
      const headerCells = this._parseMarkdownTableRow(lines[index]);
      const separatorCells = this._parseMarkdownTableRow(lines[index + 1] || '');

      if (
        !this._isMetricCatalogTableHeader(headerCells) ||
        !this._isMarkdownTableSeparator(separatorCells)
      ) {
        output.push(lines[index]);
        continue;
      }

      output.push(
        '| Metric | Type | Fields | Description |',
        '|:------------------------------------------|:--------------|:------------------------------|:------------------------------------------------|'
      );
      index += 2;

      while (index < lines.length) {
        const rowCells = this._parseMarkdownTableRow(lines[index]);
        if (!rowCells || rowCells.length !== 4) {
          break;
        }

        const [metric, type, fields, description] = rowCells;
        output.push(
          `| ${this._formatReferenceTableCell(metric)} | ${this._formatReferenceTableCell(
            type
          )} | ${this._formatReferenceTableCell(fields)} | ${this._formatReferenceTableCell(
            description
          )} |`
        );

        index++;
      }

      index--;
    }

    return output.join('\n');
  }

  _formatSandboxApprovalTablesForPdf(content) {
    const lines = String(content || '').split('\n');
    const output = [];

    for (let index = 0; index < lines.length; index++) {
      const headerCells = this._parseMarkdownTableRow(lines[index]);
      const separatorCells = this._parseMarkdownTableRow(lines[index + 1] || '');

      if (
        !this._isSandboxApprovalTableHeader(headerCells) ||
        !this._isMarkdownTableSeparator(separatorCells)
      ) {
        output.push(lines[index]);
        continue;
      }

      output.push(
        '| Intent | Flags | Effect |',
        '|:--------------------------------|:----------------------------------------------|:----------------------------------------------------|'
      );
      index += 2;

      while (index < lines.length) {
        const rowCells = this._parseMarkdownTableRow(lines[index]);
        if (!rowCells || rowCells.length !== 3) {
          break;
        }

        const [intent, flags, effect] = rowCells;
        output.push(
          `| ${this._formatReferenceTableCell(intent)} | ${this._formatReferenceTableCell(
            flags
          )} | ${this._formatReferenceTableCell(effect)} |`
        );

        index++;
      }

      index--;
    }

    return output.join('\n');
  }

  _isSandboxApprovalTableHeader(cells) {
    if (!cells || cells.length !== 3) {
      return false;
    }

    const normalized = cells.map((cell) => cell.replace(/\s+/g, ' ').trim().toLowerCase());

    return normalized[0] === 'intent' && normalized[1] === 'flags' && normalized[2] === 'effect';
  }

  _isMetricCatalogTableHeader(cells) {
    if (!cells || cells.length !== 4) {
      return false;
    }

    const normalized = cells.map((cell) => cell.replace(/\s+/g, ' ').trim().toLowerCase());

    return (
      normalized[0] === 'metric' &&
      normalized[1] === 'type' &&
      normalized[2] === 'fields' &&
      normalized[3] === 'description'
    );
  }

  _isReferenceTableHeader(cells) {
    if (!cells || cells.length !== 3) {
      return false;
    }

    const normalized = cells.map((cell) => cell.replace(/\s+/g, ' ').trim().toLowerCase());

    return (
      normalized[0] === 'key' &&
      normalized[1] === 'type / values' &&
      normalized[2] === 'details'
    );
  }

  _isMarkdownTableSeparator(cells) {
    return (
      Array.isArray(cells) &&
      cells.length > 0 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
    );
  }

  _parseMarkdownTableRow(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      return null;
    }

    const cells = [];
    let current = '';
    const body = trimmed.slice(1, -1);
    let inlineCodeTicks = 0;

    for (let index = 0; index < body.length; index++) {
      const char = body[index];
      const previous = index > 0 ? body[index - 1] : '';

      if (char === '`') {
        const tickCount = this._countBackticks(body, index);
        const marker = '`'.repeat(tickCount);
        current += marker;
        if (inlineCodeTicks === 0) {
          inlineCodeTicks = tickCount;
        } else if (tickCount === inlineCodeTicks) {
          inlineCodeTicks = 0;
        }
        index += tickCount - 1;
        continue;
      }

      if (char === '|' && previous !== '\\' && inlineCodeTicks === 0) {
        cells.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim());

    return cells;
  }

  _normalizeReferenceTableCell(cell) {
    return String(cell || '').replace(/\\\|/g, '|').trim();
  }

  _stripWrappingCodeSpan(value) {
    const trimmed = String(value || '').trim();
    const match = trimmed.match(/^`([^`]*)`$/s);
    return match ? match[1].trim() : trimmed;
  }

  _normalizeReferenceCardBlocks(content) {
    const lines = String(content || '').split('\n');
    const output = [];
    const seenKeys = new Set();

    for (let index = 0; index < lines.length; index++) {
      const headerCells = this._parseMarkdownTableRow(lines[index]);
      const separatorCells = this._parseMarkdownTableRow(lines[index + 1] || '');
      if (
        this._isReferenceTableHeader(headerCells) &&
        this._isMarkdownTableSeparator(separatorCells)
      ) {
        output.push(lines[index], lines[index + 1]);
        index += 2;

        while (index < lines.length) {
          const rowCells = this._parseMarkdownTableRow(lines[index]);
          if (!rowCells || rowCells.length !== 3) {
            break;
          }

          seenKeys.add(this._referenceKeyId(rowCells[0]));
          output.push(lines[index]);
          index++;
        }

        index--;
        continue;
      }

      const block = this._parseReferenceCardBlock(lines, index);
      if (!block) {
        output.push(lines[index]);
        this._rememberLinearizedReferenceKey(lines[index], seenKeys);
        continue;
      }

      if (!seenKeys.has(block.keyId)) {
        output.push(
          `**Key:** ${block.key}`,
          '',
          `**Type / Values:** ${this._stripWrappingCodeSpan(block.typeValues)}`,
          '',
          `**Details:** ${block.details}`,
          ''
        );
        seenKeys.add(block.keyId);
      }

      index = block.endIndex;
    }

    return output.join('\n');
  }

  _rememberLinearizedReferenceKey(line, seenKeys) {
    const match = String(line || '').match(/^\*\*Key:\*\*\s+(.+)$/);
    if (match) {
      seenKeys.add(this._referenceKeyId(match[1]));
    }
  }

  _parseReferenceCardBlock(lines, startIndex) {
    if (String(lines[startIndex] || '').trim() !== 'Key') {
      return null;
    }

    const keyIndex = this._nextNonBlankLineIndex(lines, startIndex + 1);
    const typeLabelIndex = this._nextNonBlankLineIndex(lines, keyIndex + 1);
    const typeValueIndex = this._nextNonBlankLineIndex(lines, typeLabelIndex + 1);
    const detailsLabelIndex = this._nextNonBlankLineIndex(lines, typeValueIndex + 1);
    const detailsStartIndex = this._nextNonBlankLineIndex(lines, detailsLabelIndex + 1);

    if (
      keyIndex === -1 ||
      typeLabelIndex === -1 ||
      typeValueIndex === -1 ||
      detailsLabelIndex === -1 ||
      detailsStartIndex === -1 ||
      String(lines[typeLabelIndex]).trim() !== 'Type / Values' ||
      String(lines[detailsLabelIndex]).trim() !== 'Details'
    ) {
      return null;
    }

    const detailLines = [];
    let endIndex = detailsStartIndex;

    for (let index = detailsStartIndex; index < lines.length; index++) {
      if (String(lines[index] || '').trim() === '') {
        break;
      }

      detailLines.push(lines[index].trim());
      endIndex = index;
    }

    if (detailLines.length === 0) {
      return null;
    }

    const key = String(lines[keyIndex] || '').trim();

    return {
      key,
      keyId: this._referenceKeyId(key),
      typeValues: String(lines[typeValueIndex] || '').trim(),
      details: detailLines.join(' '),
      endIndex,
    };
  }

  _nextNonBlankLineIndex(lines, startIndex) {
    for (let index = startIndex; index < lines.length; index++) {
      if (String(lines[index] || '').trim() !== '') {
        return index;
      }
    }

    return -1;
  }

  _referenceKeyId(value) {
    return this._stripWrappingCodeSpan(this._normalizeReferenceTableCell(value));
  }

  _convertLongInlineCodeToBreakablePaths(content) {
    return this._mapProseSegments(String(content || ''), (segment) =>
      segment.split('\n')
        .map((line) => /^\s*#/.test(line) ? line : this._convertLongInlineCodeLineToBreakablePaths(line))
        .join('\n')
    );
  }

  _convertLongInlineCodeLineToBreakablePaths(line) {
    let output = '';
    let index = 0;

    while (index < line.length) {
      const openingIndex = line.indexOf('`', index);
      if (openingIndex === -1) {
        output += line.slice(index);
        break;
      }

      const tickCount = this._countBackticks(line, openingIndex);
      const marker = '`'.repeat(tickCount);
      const codeStart = openingIndex + tickCount;
      const closingIndex = this._findClosingBacktickRun(line, marker, codeStart);

      if (closingIndex === -1) {
        output += line.slice(index);
        break;
      }

      const code = line.slice(codeStart, closingIndex);
      output += line.slice(index, openingIndex);
      output += this._convertInlineCodePath(code, marker);
      index = closingIndex + tickCount;
    }

    return output;
  }

  _countBackticks(line, startIndex) {
    let count = 0;
    while (line[startIndex + count] === '`') {
      count++;
    }
    return count;
  }

  _findClosingBacktickRun(line, marker, startIndex) {
    let searchIndex = startIndex;

    while (searchIndex < line.length) {
      const closingIndex = line.indexOf('`', searchIndex);
      if (closingIndex === -1) {
        return -1;
      }

      const tickCount = this._countBackticks(line, closingIndex);
      if (tickCount === marker.length) {
        return closingIndex;
      }

      searchIndex = closingIndex + tickCount;
    }

    return -1;
  }

  _convertInlineCodePath(code, marker) {
    const shouldConvert =
      code.includes('|')
      || (code.length >= 12 && /[\\/._:[\]-]/.test(code))
      || (code.length >= 12 && !/[\\/._:\s-]/.test(code) && /[a-z0-9][A-Z]/.test(code));

    if (!shouldConvert) {
      return `${marker}${code}${marker}`;
    }

    return `\\texttt{${this._escapeBreakableInlineCodeForLatex(code)}}`;
  }

  _escapeBreakableInlineCodeForLatex(code) {
    const escaped = [];
    const breakAfter = new Set(['/', '\\', '.', '_', '-', ':', '|', ',', '=', '{', '}', '[', ']']);

    for (let index = 0; index < code.length; index++) {
      const char = code[index];
      if (index > 0 && /[a-z0-9]/.test(code[index - 1]) && /[A-Z]/.test(char)) {
        escaped.push('\\allowbreak{}');
      }

      switch (char) {
        case '\\':
          escaped.push('\\textbackslash{}');
          break;
        case '$':
          escaped.push('\\$');
          break;
        case '%':
          escaped.push('\\%');
          break;
        case '&':
          escaped.push('\\&');
          break;
        case '#':
          escaped.push('\\#');
          break;
        case '_':
          escaped.push('\\_');
          break;
        case '{':
          escaped.push('\\{');
          break;
        case '}':
          escaped.push('\\}');
          break;
        case '~':
          escaped.push('\\textasciitilde{}');
          break;
        case '^':
          escaped.push('\\textasciicircum{}');
          break;
        case '|':
          escaped.push('|');
          break;
        default:
          escaped.push(char);
      }

      if (breakAfter.has(char)) {
        escaped.push('\\allowbreak{}');
      }
    }

    return escaped.join('');
  }

  /**
   * Remove YAML frontmatter from markdown content
   * @private
   */
  _removeFrontmatter(content) {
    if (!content || !content.startsWith('---\n')) {
      return content;
    }

    const endIndex = content.indexOf('\n---\n', 4);
    if (endIndex === -1) {
      return content;
    }

    return content.slice(endIndex + 5).replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
  }

  /**
   * Extract title from markdown content (first H1 or H2)
   * @private
   */
  _extractTitleFromContent(content) {
    const match = content.match(/^#{1,2}\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /**
   * Strip the first heading from content if it matches the injected title
   * This prevents duplicate titles in the TOC
   * @param {string} content - Markdown content
   * @param {string} title - Title being injected
   * @returns {string} - Content with leading title removed if it was a duplicate
   * @private
   */
  _stripLeadingTitle(content, title) {
    if (!content || !title) return content;

    // Match first H1 or H2 at the start of content (after possible whitespace)
    const match = content.match(/^\s*(#{1,2})\s+(.+?)(\r?\n|$)/);
    if (!match) return content;

    const headingTitle = match[2].trim();
    // Compare normalized titles (case-insensitive, ignore extra whitespace)
    const normalizedInjected = title.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedExisting = headingTitle.toLowerCase().replace(/\s+/g, ' ').trim();

    if (normalizedInjected === normalizedExisting) {
      // Remove the duplicate heading
      return content.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
    }

    return content;
  }

  _prepareArticleContentForBatch(content, title, pageUrl) {
    const withoutIndex = this._stripLeadingDocumentationIndexCallout(content);
    const withoutTitle = this._stripLeadingTitle(withoutIndex, title);
    return this._demoteMarkdownHeadings(this._cleanMarkdownContent(withoutTitle, pageUrl));
  }

  _stripLeadingDocumentationIndexCallout(content) {
    const lines = String(content || '').split('\n');
    let index = 0;
    while (index < lines.length && !lines[index].trim()) index++;

    if (!/^>\s*##\s+Documentation Index\s*$/i.test(lines[index] || '')) {
      return content;
    }

    while (index < lines.length && /^>/.test(lines[index])) index++;
    while (index < lines.length && !lines[index].trim()) index++;
    return lines.slice(index).join('\n').trimEnd();
  }

  _demoteMarkdownHeadings(content) {
    return this._mapProseSegments(content, (segment) =>
      segment.replace(/^(#{1,5})(\s+)/gm, '#$1$2')
    );
  }
}
