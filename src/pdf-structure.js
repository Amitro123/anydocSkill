/**
 * Read a tagged PDF's structure tree instead of inferring layout from coordinates.
 *
 * A tagged PDF (anything exported by Word, LibreOffice and most modern tools) carries
 * a structure tree declaring paragraphs, lists and tables. Reading it gives exact
 * boundaries where the geometry heuristics in pdf-extract.js can only guess, and it
 * naturally skips headers, footers and other artifacts, which are untagged.
 *
 * The ceiling is set by how the source was authored: a document formatted by hand
 * rather than with real heading styles tags everything as P, so no headings appear
 * however well this reads the tree.
 */

const { joinItems } = require('./pdf-extract');

const HEADING_ROLES = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

// Text is attached to the innermost marked-content id enclosing it.
function itemsByMarkedContentId(items) {
  const byId = new Map();
  const stack = [];

  for (const item of items) {
    if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
      stack.push(item.id || null);
    } else if (item.type === 'endMarkedContent') {
      stack.pop();
    } else if (typeof item.str === 'string') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (!stack[i]) continue;
        if (!byId.has(stack[i])) byId.set(stack[i], []);
        byId.get(stack[i]).push(item);
        break;
      }
    }
  }
  return byId;
}

function nodeText(node, byId) {
  const collected = [];
  (function walk(n) {
    if (!n) return;
    if (n.type === 'content' && byId.has(n.id)) collected.push(...byId.get(n.id));
    (n.children || []).forEach(walk);
  })(node);

  return collected.length ? joinItems(collected) : '';
}

const numericLabel = label => {
  const match = label.match(/^(\d+)\s*[.)]?$/);
  return match ? Number(match[1]) : null;
};

/**
 * Split a list into runs that share a numbering style.
 *
 * A tagged list often mixes kinds — a court form puts its lettered options and the
 * numbered sub-clauses under one L node — and judging the whole list by its first
 * label would force every item into the same shape.
 */
function labelRuns(entries) {
  const runs = [];

  for (const entry of entries) {
    const value = numericLabel(entry.label);
    const last = runs[runs.length - 1];
    // A numbered run must continue the sequence Markdown would render, or it starts
    // a new run — otherwise Markdown silently renumbers the document.
    const continues = last && last.ordered && value !== null &&
      value === numericLabel(last.entries[0].label) + last.entries.length;

    if (continues) last.entries.push(entry);
    else if (value !== null) runs.push({ ordered: true, entries: [entry] });
    else if (last && !last.ordered) last.entries.push(entry);
    else runs.push({ ordered: false, entries: [entry] });
  }
  return runs;
}

function renderList(node, byId) {
  const entries = (node.children || []).filter(c => c.role === 'LI').map(li => {
    const parts = li.children || [];
    const label = parts.filter(p => p.role === 'Lbl').map(p => nodeText(p, byId)).join(' ').trim();
    const bodyNodes = parts.filter(p => p.role !== 'Lbl');
    let body = (bodyNodes.length
      ? bodyNodes.map(p => nodeText(p, byId)).filter(Boolean).join(' ')
      : nodeText(li, byId)).trim();

    // Hebrew numbering renders as ".1", so the separator lands at the head of the
    // body. Markdown supplies its own, and a bullet does not need one.
    if (label) body = body.replace(/^[.)]\s*/, '');
    return { label, body };
  }).filter(e => e.label || e.body);

  if (!entries.length) return [];

  return labelRuns(entries).map(run => {
    if (run.ordered) {
      const start = numericLabel(run.entries[0].label);
      return run.entries.map((e, i) => `${start + i}. ${e.body}`).join('\n');
    }
    return run.entries.map(e => `- ${[e.label, e.body].filter(Boolean).join(' ')}`).join('\n');
  });
}

function renderNode(node, byId, blocks) {
  if (!node) return;
  const role = node.role;

  if (role === 'L') {
    blocks.push(...renderList(node, byId));
    return;
  }

  if (HEADING_ROLES[role]) {
    const text = nodeText(node, byId);
    if (text) blocks.push(`${'#'.repeat(HEADING_ROLES[role])} ${text}`);
    return;
  }

  if (role === 'P' || role === 'Caption') {
    const text = nodeText(node, byId);
    if (text) blocks.push(text);
    return;
  }

  (node.children || []).forEach(child => renderNode(child, byId, blocks));
}

/**
 * @param {object} pdfjs - The loaded pdf.js module
 * @param {object} doc - An open PDFDocumentProxy
 * @returns {Promise<{markdown: string, coverage: number}>} coverage is the share of
 *   page text the structure tree accounted for, used to decide whether to trust it.
 */
async function structuredMarkdown(doc) {
  const blocks = [];
  let tagged = 0;
  let total = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tree = await page.getStructTree();
    if (!tree) continue;

    const { items } = await page.getTextContent({ includeMarkedContent: true });
    const byId = itemsByMarkedContentId(items);

    const before = blocks.length;
    renderNode(tree, byId, blocks);

    total += items.filter(i => typeof i.str === 'string').reduce((n2, i) => n2 + i.str.length, 0);
    tagged += blocks.slice(before).join('').length;
  }

  return {
    markdown: blocks.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
    coverage: total ? tagged / total : 0,
  };
}

module.exports = { structuredMarkdown, _internals: { labelRuns, numericLabel } };
