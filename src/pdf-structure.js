/**
 * Read a tagged PDF's structure tree instead of inferring layout from coordinates.
 *
 * A tagged PDF (anything exported by Word, LibreOffice and most modern tools) carries
 * a structure tree declaring paragraphs, lists and tables. Reading it gives exact
 * boundaries where the geometry heuristics in pdf-extract.js can only guess.
 *
 * Headers, footers and other page furniture are untagged, so the tree does not reach
 * them. They are collected separately and filtered the way pdf-extract.js filters them
 * — dropped only when they repeat on every page — because a strip that appears once is
 * not furniture. On a one-page extract it is often the only place a company name or a
 * contact detail appears, and dropping it unconditionally loses content silently.
 *
 * The ceiling is set by how the source was authored: a document formatted by hand
 * rather than with real heading styles tags everything as P, so no headings appear
 * however well this reads the tree.
 */

const {
  joinItems, repeatedFurniture, escapeBlockMarker, _internals: { joinOneLine },
} = require('./pdf-extract');

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

function nodeText(node, byId, used) {
  const collected = [];
  (function walk(n) {
    if (!n) return;
    if (n.type === 'content' && byId.has(n.id)) {
      collected.push(...byId.get(n.id));
      used.add(n.id);
    }
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

function renderList(node, byId, used) {
  const entries = (node.children || []).filter(c => c.role === 'LI').map(li => {
    const parts = li.children || [];
    const label = parts.filter(p => p.role === 'Lbl').map(p => nodeText(p, byId, used)).join(' ').trim();
    const bodyNodes = parts.filter(p => p.role !== 'Lbl');
    let body = (bodyNodes.length
      ? bodyNodes.map(p => nodeText(p, byId, used)).filter(Boolean).join(' ')
      : nodeText(li, byId, used)).trim();

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

/**
 * Render a tagged table, or return null when the tags do not describe a grid.
 *
 * Where the geometry path has to infer columns from where cells sit, a tagged table
 * states them, so this is the reading to trust. It still has to come out rectangular:
 * Markdown has no row or column spans, and a ragged table would silently shift cells
 * into the wrong columns. Anything that is not a clean grid falls back to the cells
 * being read as ordinary paragraphs, which loses the shape but never moves a value.
 */
function renderTable(node, byId, used) {
  const rows = [];
  (function walk(n) {
    if (!n) return;
    if (n.role === 'TR') {
      const cells = (n.children || []).filter(c => c.role === 'TD' || c.role === 'TH');
      if (cells.length) rows.push(cells.map(c => nodeText(c, byId, used).replace(/\|/g, '\\|')));
      return;
    }
    (n.children || []).forEach(walk);
  })(node);

  const width = rows.length ? rows[0].length : 0;
  if (rows.length < 2 || width < 2 || rows.some(r => r.length !== width)) return null;

  // A grid holding no text is a layout table — the way a hand-formatted page positions
  // images — and rendering it emits a table of empty cells where the page showed art.
  if (!rows[0].every(Boolean) || !rows.slice(1).some(r => r.some(Boolean))) return null;

  return [rows[0], rows[0].map(() => '---'), ...rows.slice(1)]
    .map(cells => `| ${cells.join(' | ')} |`).join('\n');
}

function renderNode(node, byId, blocks, used) {
  if (!node) return;
  const role = node.role;

  if (role === 'Table') {
    const table = renderTable(node, byId, used);
    if (table) {
      blocks.push(table);
      return;
    }
  }

  if (role === 'L') {
    blocks.push(...renderList(node, byId, used));
    return;
  }

  if (HEADING_ROLES[role]) {
    const text = nodeText(node, byId, used);
    if (text) blocks.push(`${'#'.repeat(HEADING_ROLES[role])} ${text}`);
    return;
  }

  if (role === 'P' || role === 'Caption') {
    const text = nodeText(node, byId, used);
    if (text) blocks.push(escapeBlockMarker(text));
    return;
  }

  (node.children || []).forEach(child => renderNode(child, byId, blocks, used));
}

const SAME_LINE = 2;  // baselines within this many units are one line

/**
 * Read the page text the structure tree never claimed, as lines.
 *
 * Split around the tagged content's vertical span so a header stays before the body and
 * a footer after it, rather than all of it landing at one end of the page.
 */
function untaggedLines(items, byId, used) {
  const claimed = new Set();
  for (const [id, group] of byId) {
    if (used.has(id)) group.forEach(item => claimed.add(item));
  }

  const loose = items.filter(i => typeof i.str === 'string' && i.str.trim() && !claimed.has(i));
  if (!loose.length) return { above: [], below: [] };

  const claimedYs = [...claimed].map(i => i.transform[5]);
  const top = claimedYs.length ? Math.max(...claimedYs) : -Infinity;

  const lines = [];
  for (const item of [...loose].sort((a, b) => b.transform[5] - a.transform[5])) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].transform[5] - item.transform[5]) < SAME_LINE) last.push(item);
    else lines.push([item]);
  }

  const above = [];
  const below = [];
  for (const line of lines) {
    const text = joinOneLine(line);
    if (text) (line[0].transform[5] > top ? above : below).push(escapeBlockMarker(text));
  }
  return { above, below };
}

/**
 * @param {object} doc - An open PDFDocumentProxy
 * @param {(n: number) => boolean} [keep] - Which 1-indexed pages to include
 * @returns {Promise<{markdown: string, coverage: number}>} coverage is the share of
 *   page text the structure tree accounted for, used to decide whether to trust it.
 */
async function structuredMarkdown(doc, keep = () => true) {
  const pages = [];
  let tagged = 0;
  let total = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    if (!keep(n)) continue;
    const page = await doc.getPage(n);
    const tree = await page.getStructTree();
    if (!tree) continue;

    const { items } = await page.getTextContent({ includeMarkedContent: true });
    const byId = itemsByMarkedContentId(items);

    const blocks = [];
    const used = new Set();
    renderNode(tree, byId, blocks, used);

    total += items.filter(i => typeof i.str === 'string').reduce((n2, i) => n2 + i.str.length, 0);
    tagged += blocks.join('').length;

    pages.push({ blocks, ...untaggedLines(items, byId, used) });
  }

  // Coverage still measures the tree alone: it decides whether to trust the tree's
  // paragraph boundaries, which recovered furniture says nothing about.
  return {
    markdown: assemble(pages).replace(/\n{3,}/g, '\n\n').trim() + '\n',
    coverage: total ? tagged / total : 0,
  };
}

// Only the untagged text can be furniture here — the tree already told us the rest is
// content — and of that, only what repeats on every page. Same test as the geometry
// path, so a PDF converts the same whether or not it carries a structure tree.
function assemble(pages) {
  const furniture = repeatedFurniture(
    pages.map(p => [...p.above, ...p.below]),
    pages.map(p => p.blocks.length + p.above.length + p.below.length)
  );
  const keep = text => !furniture.has(text);

  return pages
    .flatMap(p => [...p.above.filter(keep), ...p.blocks, ...p.below.filter(keep)])
    .filter(Boolean)
    .join('\n\n');
}

module.exports = { structuredMarkdown, _internals: { labelRuns, numericLabel, untaggedLines, assemble, renderTable } };
