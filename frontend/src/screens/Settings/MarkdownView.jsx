// Tiny curated markdown renderer — handles headers, code blocks, inline code,
// unordered lists, and paragraphs. No heavyweight deps.

export default function MarkdownView({ source }) {
  if (!source) return null;
  const blocks = parseBlocks(source);
  return (
    <div className="md" style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text, #1a1a2e)', lineHeight: 1.6 }}>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
}

function parseBlocks(src) {
  const blocks = [];
  const lines = src.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing ```
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    // Blank line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', content: line.slice(4) });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', content: line.slice(3) });
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', content: line.slice(2) });
      i++;
      continue;
    }

    // Unordered list — collect consecutive list items
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Paragraph — collect consecutive non-blank, non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('# ') &&
      !lines[i].startsWith('## ') &&
      !lines[i].startsWith('### ') &&
      !lines[i].startsWith('- ') &&
      !lines[i].startsWith('* ') &&
      !lines[i].trimStart().startsWith('```')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'p', content: paraLines.join(' ') });
    }
  }

  return blocks;
}

function renderBlock(b, i) {
  switch (b.type) {
    case 'h1':
      return <h2 key={i} style={{ fontSize: 22, fontWeight: 700, marginTop: 24, marginBottom: 8 }}>{renderInline(b.content)}</h2>;
    case 'h2':
      return <h3 key={i} style={{ fontSize: 17, fontWeight: 600, marginTop: 20, marginBottom: 6 }}>{renderInline(b.content)}</h3>;
    case 'h3':
      return <h4 key={i} style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 4 }}>{renderInline(b.content)}</h4>;
    case 'code':
      return (
        <pre key={i} style={{ background: '#f6f8fa', padding: 12, borderRadius: 6, overflow: 'auto', fontSize: 12.5, marginBottom: 12, border: '1px solid rgba(0,0,0,0.07)' }}>
          <code>{b.content}</code>
        </pre>
      );
    case 'ul':
      return (
        <ul key={i} style={{ paddingLeft: 24, marginBottom: 12, marginTop: 0 }}>
          {b.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{renderInline(it)}</li>)}
        </ul>
      );
    default:
      return <p key={i} style={{ marginBottom: 12, lineHeight: 1.55 }}>{renderInline(b.content)}</p>;
  }
}

function renderInline(text) {
  if (!text) return null;
  // Split on `inline code` spans
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} style={{
          background: '#f0f2f5', borderRadius: 3, padding: '1px 5px',
          fontSize: '0.9em', fontFamily: 'monospace',
        }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
