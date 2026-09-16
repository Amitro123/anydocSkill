/**
 * Render RTL-aware Markdown (as produced by rtl.js) into a standalone HTML document.
 *
 * Direction is carried by dir/lang on the <html> element. `dir` is an inherited
 * attribute, so the whole document resolves under the right base direction and the
 * Unicode bidi algorithm handles mixed Hebrew/Latin runs correctly. CSS `direction`
 * alone does not do this reliably.
 */

const { marked } = require('marked');

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: markdown };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: markdown.slice(match[0].length) };
}

// rtl.js wraps the body in <div dir="rtl">; the <html dir> makes it redundant.
function unwrapRtlDiv(body) {
  return body.replace(/^\s*<div dir="rtl"[^>]*>\s*/, '').replace(/\s*<\/div>\s*$/, '');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

function documentCss(dir) {
  const startEdge = dir === 'rtl' ? 'right' : 'left';
  return `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.25rem;
    background: #f7f5f0;
    color: #1e1c18;
    font-family: "Frank Ruhl Libre", "Noto Serif Hebrew", "David Libre", Georgia, serif;
    font-size: 17px;
    line-height: 1.85;
  }
  main {
    max-width: 46rem;
    margin: 0 auto;
    background: #fff;
    padding: 3rem 3.25rem;
    border: 1px solid #ddd9d0;
    border-radius: 4px;
  }
  h1, h2, h3 { line-height: 1.3; text-wrap: balance; margin: 2rem 0 1rem; }
  h1 { font-size: 1.9rem; text-align: center; margin-top: 0; }
  h2 { font-size: 1.35rem; }
  h3 { font-size: 1.1rem; }
  p { margin: 0 0 1rem; }
  ol, ul { padding-inline-start: 1.5rem; margin: 0 0 1rem; }
  li { margin-bottom: .6rem; }
  hr { border: 0; border-top: 1px solid #ddd9d0; margin: 2rem 0; }
  blockquote {
    margin: 1rem 0;
    padding-inline-start: 1rem;
    border-inline-start: 3px solid #9b7d3a;
    color: #4a4843;
  }
  code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: .9em;
    background: #f0ede6;
    padding: .1em .35em;
    border-radius: 3px;
  }
  pre { background: #f0ede6; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  .table-scroll { overflow-x: auto; margin: 0 0 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: .95em; }
  th, td {
    border: 1px solid #ddd9d0;
    padding: .55rem .8rem;
    text-align: ${startEdge};
  }
  th { background: #f0ede6; font-weight: 600; }
  img { max-width: 100%; height: auto; }

  @media (prefers-color-scheme: dark) {
    body { background: #141210; color: #f0ede6; }
    main { background: #1e1c18; border-color: #302e28; }
    th { background: #252320; }
    th, td, hr { border-color: #302e28; }
    code, pre { background: #242220; }
    blockquote { color: #9a9590; }
  }

  @media print {
    body { background: #fff; padding: 0; font-size: 12pt; }
    main { border: 0; border-radius: 0; max-width: none; padding: 0; }
  }

  @media (max-width: 640px) {
    body { padding: 1.5rem 1rem; }
    main { padding: 1.75rem 1.25rem; }
  }`;
}

/**
 * @param {string} markdown - RTL-aware Markdown (front-matter optional)
 * @param {object} [opts]
 * @param {string} [opts.title] - Overrides the front-matter title
 * @returns {string} A complete standalone HTML document
 */
function renderHtml(markdown, opts = {}) {
  const { meta, body } = parseFrontMatter(markdown);
  const dir = meta.dir === 'rtl' ? 'rtl' : 'ltr';
  const lang = meta.lang || (dir === 'rtl' ? 'he' : 'en');
  const title = opts.title || meta.title || 'Document';

  marked.use({ gfm: true, breaks: false });
  let content = marked.parse(dir === 'rtl' ? unwrapRtlDiv(body) : body);

  // Tables need their own scroll container so the page never scrolls sideways.
  content = content.replace(/<table>/g, '<div class="table-scroll"><table>')
                   .replace(/<\/table>/g, '</table></div>');

  return `<!doctype html>
<html dir="${dir}" lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${documentCss(dir)}
</style>
</head>
<body>
<main>
${content.trim()}
</main>
</body>
</html>
`;
}

module.exports = { renderHtml, parseFrontMatter };
