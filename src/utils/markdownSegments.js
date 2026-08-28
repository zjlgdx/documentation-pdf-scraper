import { fromMarkdown } from 'mdast-util-from-markdown';

/** Transform prose without rewriting fenced/indented code (or inline examples). */
export function mapMarkdownProse(content, transform, { inlineCode = false } = {}) {
  if (!content) return content;
  const ranges = [];
  const visit = (node) => {
    if (node.type === 'code' || (inlineCode && node.type === 'inlineCode')) {
      const start = node.position.start.offset;
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      ranges.push([node.type === 'code' ? lineStart : start, node.position.end.offset]);
      return;
    }
    node.children?.forEach(visit);
  };
  visit(fromMarkdown(content));
  let offset = 0;
  const parts = [];
  for (const [start, end] of ranges) {
    parts.push(transform(content.slice(offset, start)), content.slice(start, end));
    offset = end;
  }
  parts.push(transform(content.slice(offset)));
  return parts.join('');
}
