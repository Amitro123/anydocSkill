/**
 * PDF → Markdown via pdf.js.
 *
 * The firecrawl/anydoc extractor — the dependency, not this tool — emits Hebrew in
 * visual order (every word character-reversed), which cannot be repaired downstream.
 * pdf.js returns text items already in logical reading order, so this module
 * reconstructs lines and paragraphs from item geometry instead.
 *
 * A tagged PDF is read through pdf-structure.js, which uses the document's own
 * structure tree. This geometry path is the fallback for untagged PDFs: it infers
 * paragraphs from line gaps and line widths, and leaves source numbering as literal
 * text so clause numbers in legal documents are never silently renumbered.
 */

const PARAGRAPH_GAP_RATIO = 1.6;  // line gap beyond this multiple of the body gap starts a paragraph
const SHORT_LINE_RATIO = 0.75;    // a line narrower than this fraction of the column ends a paragraph

// A line this many times the page's typical font size is a heading candidate. Measured
// against real documents: a genuine section title sits at 1.4x body size or higher, and
// a subheading close enough to body size to be legitimately ambiguous — a 12pt aside next
// to 11pt body — sits under 1.3x. The gap between those is where the line is drawn.
const HEADING_SIZE_RATIO = 1.3;
const MAX_HEADING_LENGTH = 80;    // longer than this is a large paragraph, not a title

// pdfjs-dist ships glyph-width metrics for the 14 standard PDF fonts; pointing it there
// is what stops it warning to stderr whenever a page references one it cannot otherwise
// measure — harmless to the read itself, but noise worth not having.
const STANDARD_FONTS = `${require('path').join(
  require.resolve('pdfjs-dist/package.json', { paths: [__dirname] }), '..', 'standard_fonts')}/`;

async function loadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

// pdf.js marks line ends with hasEOL. Items carry x (left edge), y and width.
function itemsToLines(items) {
  const lines = [];
  let current = [];

  for (const item of items) {
    if (item.str) current.push(item);
    if (item.hasEOL && current.length) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

const HEBREW_OR_ARABIC = /[֐-ۿיִ-﻿]/;
const LTR_CONTENT = /[0-9A-Za-z]/;

const isLtrItem = item => LTR_CONTENT.test(item.str) && !HEBREW_OR_ARABIC.test(item.str);
const isNeutralItem = item => !LTR_CONTENT.test(item.str) && !HEBREW_OR_ARABIC.test(item.str);

/**
 * Put embedded left-to-right runs back into logical order.
 *
 * In an RTL paragraph pdf.js emits items right-to-left, which is logical order for
 * Hebrew but reverses a run that reads left-to-right internally. A case number split
 * across items ("26", "-", "07", "-", "123456") therefore arrives backwards and joins
 * as 26-01-123456 instead of 123456-01-26. Sorting each such run by ascending x
 * restores it; a single-item run is unaffected.
 */
function reorderLtrRuns(items) {
  if (!items.some(isLtrItem)) return items;

  const ordered = [];
  let i = 0;

  while (i < items.length) {
    if (!isLtrItem(items[i])) {
      ordered.push(items[i]);
      i++;
      continue;
    }
    // Extend across neutrals (separators, spaces) so "01-123456" stays one run,
    // then trim neutrals off the tail so they keep their place in the Hebrew flow.
    let end = i + 1;
    while (end < items.length && (isLtrItem(items[end]) || isNeutralItem(items[end]))) end++;
    while (end - 1 > i && isNeutralItem(items[end - 1])) end--;

    ordered.push(...items.slice(i, end).sort((a, b) => a.transform[4] - b.transform[4]));
    i = end;
  }
  return ordered;
}

// PDFs usually space words by positioning glyphs rather than emitting space
// characters, so word breaks have to be read back from the gaps between items.
function joinOneLine(rawItems) {
  // Producers disagree about the order they emit items in: Word writes an RTL line
  // right-to-left, other tools write it left-to-right. Array order is therefore not
  // reading order, and trusting it reverses the words of every Hebrew line from the
  // second kind of producer. Position is the only reliable source, so an RTL line is
  // ordered by descending x — a no-op when the producer already emitted it that way.
  const items = HEBREW_OR_ARABIC.test(rawItems.map(i => i.str).join(''))
    ? reorderLtrRuns([...rawItems].sort((a, b) => b.transform[4] - a.transform[4]))
    : rawItems;
  let text = '';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i > 0) {
      const prev = items[i - 1];
      const prevRight = prev.transform[4] + (prev.width || 0);
      const curRight = item.transform[4] + (item.width || 0);
      // Ordering is direction-agnostic: take whichever edges face each other.
      const gap = item.transform[4] > prev.transform[4]
        ? item.transform[4] - prevRight
        : prev.transform[4] - curRight;
      const fontSize = Math.abs(item.transform[3]) || 10;
      if (gap > fontSize * 0.12) text += ' ';
    }
    text += item.str;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Join text items into a string, restoring word spacing from item gaps.
 *
 * Items are grouped into lines first: gap arithmetic only means anything between
 * items sharing a baseline, and a structure-tree node routinely spans several lines.
 * Runs that read left-to-right are reordered per line, never across one.
 */
function joinItems(items) {
  if (!items.length) return '';

  const lines = [];
  let line = [items[0]];

  for (let i = 1; i < items.length; i++) {
    const sameLine = Math.abs(items[i].transform[5] - line[0].transform[5]) < 2;
    if (sameLine) line.push(items[i]);
    else { lines.push(line); line = [items[i]]; }
  }
  lines.push(line);

  return lines.map(joinOneLine).filter(Boolean).join(' ');
}

/**
 * Escape a Markdown block marker a page happens to open a line with.
 *
 * Extractors return plain text, and that text is read back as Markdown. An invoice
 * whose first table column is headed `#` therefore comes back as a heading, and the
 * document grows structure the page never had.
 *
 * `#` and `>` are escaped outright: page text never means them as Markdown. A dash is
 * left alone, because a dash-prefixed line usually is the list it looks like and
 * escaping those flattened a syllabus into paragraphs — unless the line closes with
 * the same character, which is decoration (`- עמוד 1 -`) rather than a list item, as
 * no list item ends with its own marker.
 */
function escapeBlockMarker(text) {
  const decoration = text.match(/^(\s*)([-*+])(?=\s).*\2\s*$/);
  if (decoration) return text.replace(/^(\s*)([-*+])/, '$1\\$2');

  return text.replace(/^(\s*)(#{1,6}|>)(?=\s|$)/, '$1\\$2');
}

function lineY(items) {
  return items[0].transform[5];
}

// The largest glyph on the line represents it, so one oversized initial or a stray
// superscript pulls a line toward "heading" rather than a body line being pulled down
// by a footnote marker — the direction a false positive is cheaper than a false negative.
function lineFontSize(items) {
  return Math.max(...items.map(i => Math.abs(i.transform[3]) || 0)) || 10;
}

/**
 * The page's typical font size, weighted by how much text is set in it rather than by
 * how many lines are.
 *
 * A heading is short by definition, so on a page carrying as many heading-shaped lines
 * as body ones — a slide, a short flyer, this very fixture — a plain per-line median
 * lands on the heading size instead: three one-word titles and three full sentences
 * are six lines evenly split, but nowhere near an even split of the page's actual text.
 * Weighting by character count is what keeps "typical" meaning what most of the words
 * on the page are set in, which a line count alone does not.
 */
function medianFontSize(lines) {
  const entries = lines
    .map(line => ({
      size: lineFontSize(line),
      weight: line.reduce((n, item) => n + item.str.length, 0) || 1,
    }))
    .sort((a, b) => a.size - b.size);

  const total = entries.reduce((n, e) => n + e.weight, 0);
  if (!total) return 0;

  let seen = 0;
  for (const entry of entries) {
    seen += entry.weight;
    if (seen >= total / 2) return entry.size;
  }
  return entries.at(-1).size;
}

function lineLeft(items) {
  return Math.min(...items.map(i => i.transform[4]));
}

function lineRight(items) {
  return Math.max(...items.map(i => i.transform[4] + (i.width || 0)));
}

function lineWidth(items) {
  return lineRight(items) - lineLeft(items);
}

// A line that stops well short of the column edge ends its paragraph — the usual
// way a heading, a date or a final line differs from wrapped body text.
function columnWidth(lines) {
  const widths = lines.map(lineWidth).filter(w => w > 0).sort((a, b) => b - a);
  if (!widths.length) return 0;
  return widths[Math.floor(widths.length * 0.1)];
}

function medianGap(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lineY(lines[i - 1]) - lineY(lines[i]);
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

const MIN_COLUMN_LINES = 2;   // fewer than this either side is an indent, not a column

/**
 * Split lines at a vertical gutter no line crosses.
 *
 * Requiring that nothing crosses it keeps this off single-column pages, where body
 * lines span the width and leave no gap to find. Returns null when there is no split.
 */
function findGutter(lines) {
  const edges = lines.map(l => ({ left: lineLeft(l), right: lineRight(l) }));
  const min = Math.min(...edges.map(e => e.left));
  const max = Math.max(...edges.map(e => e.right));

  let best = null;
  for (let x = min; x <= max; x += 4) {
    if (edges.some(e => e.left < x && e.right > x)) continue;

    const left = lines.filter((_, i) => edges[i].right <= x);
    const right = lines.filter((_, i) => edges[i].left >= x);
    if (left.length < MIN_COLUMN_LINES || right.length < MIN_COLUMN_LINES) continue;

    // Prefer the most balanced split, so a sidebar does not get cut in half.
    const balance = Math.min(left.length, right.length);
    if (!best || balance > best.balance) best = { left, right, balance };
  }
  return best;
}

/**
 * Put a page's lines in reading order.
 *
 * Position rather than emission order, since producers disagree about the latter. A
 * page with columns is read a column at a time — nearest edge first, which is the
 * right-hand column in Hebrew — because sorting the whole page by y interleaves them.
 */
function orderLines(lines, rtl) {
  const byY = () => [...lines].sort((a, b) => lineY(b) - lineY(a));
  if (lines.length < MIN_COLUMN_LINES * 2) return byY();

  const gutter = findGutter(lines);
  if (!gutter) return byY();

  const [first, second] = rtl ? [gutter.right, gutter.left] : [gutter.left, gutter.right];
  return [...orderLines(first, rtl), ...orderLines(second, rtl)];
}

const MIN_TABLE_ROWS = 2;      // a header and one row of data
const MIN_TABLE_COLUMNS = 3;   // two aligned runs are as likely to be a label and a value
const CELL_GAP_RATIO = 0.6;    // a gap this many font sizes wide separates cells, not words

const itemLeft = item => item.transform[4];
const itemRight = item => item.transform[4] + (item.width || 0);
const cellCentre = cell => (itemLeft(cell[0]) + itemRight(cell[cell.length - 1])) / 2;

/**
 * Split one line into cells at the gaps too wide to be word spacing.
 *
 * Cells arrive in reading order — rightmost first in an RTL table — so the first
 * Markdown column is the one nearest the reader's starting edge.
 */
function lineToCells(items, rtl) {
  // Producers pad a row with whitespace items wide enough to span the gap between
  // columns. Keeping them would bridge every gap and read the row as a single cell.
  const sorted = items.filter(i => i.str.trim()).sort((a, b) =>
    rtl ? itemLeft(b) - itemLeft(a) : itemLeft(a) - itemLeft(b));
  if (!sorted.length) return [];

  const cells = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const item = sorted[i];
    const gap = rtl ? itemLeft(prev) - itemRight(item) : itemLeft(item) - itemRight(prev);
    const fontSize = Math.abs(item.transform[3]) || 10;

    if (gap > fontSize * CELL_GAP_RATIO) cells.push([item]);
    else cells[cells.length - 1].push(item);
  }
  // Each cell is ordered rightmost-first for RTL; joinOneLine re-sorts by position.
  return cells;
}

/**
 * Read a run of lines starting at `start` as a table, or return null.
 *
 * A PDF records a table as ruled lines and positioned glyphs, with nothing saying
 * which value belongs under which heading — that has to be recovered from where the
 * cells sit. Recovering it wrongly files a number under the wrong column, which on an
 * invoice is worse than the flat text this replaces, so the run is only read as a
 * table when the columns are unambiguous: every row divides into the same number of
 * cells, and the columns stand further apart than their own cells are ragged. Anything
 * less and the lines stay paragraphs.
 */
function tableAt(lines, start, rtl) {
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lineToCells(lines[i], rtl);
    if (cells.length < MIN_TABLE_COLUMNS) break;
    if (rows.length && cells.length !== rows[0].length) break;
    rows.push(cells);
  }
  if (rows.length < MIN_TABLE_ROWS) return null;

  const centres = rows[0].map((_, k) => rows.map(row => cellCentre(row[k])));
  const ragged = Math.max(...centres.map(c => Math.max(...c) - Math.min(...c)));

  const means = centres.map(c => c.reduce((a, b) => a + b, 0) / c.length);
  const apart = Math.min(...means.slice(1).map((m, k) => Math.abs(m - means[k])));
  if (ragged >= apart) return null;

  const text = row => row.map(cell => joinOneLine(cell).replace(/\|/g, '\\|'));
  if (!text(rows[0]).every(Boolean)) return null;

  const markdown = [
    text(rows[0]),
    rows[0].map(() => '---'),
    ...rows.slice(1).map(text),
  ].map(cells => `| ${cells.join(' | ')} |`).join('\n');

  return { end: start + rows.length, markdown };
}

/**
 * Whether `lines[i]` is a standalone heading, by size and by isolation.
 *
 * Size alone overpromotes: a multi-line pull quote set in the same large type as a
 * genuine title looks identical to one from a single line's font size alone, and
 * promoting each of its lines invents section breaks in the middle of one sentence —
 * this document's own front matter (`title / subtitle / author name`, three consecutive
 * large lines) is exactly that shape. Requiring the line on both sides to be back at
 * body size is what tells a title, which introduces body text and is introduced by it
 * in turn, from a run of decorative type, which is large on every side of itself. A
 * heading at the very top or bottom of a page has no neighbour on that side to check —
 * treated as satisfied there, the same as a paragraph gap has nothing to compare
 * against on a page's first line.
 */
function isHeadingLine(lines, i, bodySize) {
  if (bodySize <= 0) return null;
  const large = idx => idx >= 0 && idx < lines.length
    && lineFontSize(lines[idx]) >= bodySize * HEADING_SIZE_RATIO;
  if (!large(i) || large(i - 1) || large(i + 1)) return null;

  const text = joinOneLine(lines[i]);
  return text && text.length <= MAX_HEADING_LENGTH ? text : null;
}

function linesToParagraphs(rawLines) {
  const rtl = rawLines.some(l => HEBREW_OR_ARABIC.test(l.map(i => i.str).join('')));
  const lines = orderLines(rawLines, rtl);
  const body = medianGap(lines);
  const column = columnWidth(lines);
  const bodySize = medianFontSize(lines);
  const paragraphs = [];
  let current = [];

  const flush = () => {
    if (current.length) paragraphs.push(escapeBlockMarker(current.join(' ')));
    current = [];
  };

  for (let i = 0; i < lines.length; ) {
    const table = tableAt(lines, i, rtl);
    if (table) {
      flush();
      paragraphs.push(table.markdown);
      i = table.end;
      continue;
    }

    const heading = isHeadingLine(lines, i, bodySize);
    if (heading) {
      flush();
      paragraphs.push(`## ${heading}`);
      i++;
      continue;
    }

    const text = joinOneLine(lines[i]);
    if (!text) { i++; continue; }

    if (i > 0 && body > 0) {
      const gap = lineY(lines[i - 1]) - lineY(lines[i]);
      if (gap > body * PARAGRAPH_GAP_RATIO || gap < 0) flush();
    }

    current.push(text);
    if (column > 0 && lineWidth(lines[i]) < column * SHORT_LINE_RATIO) flush();
    i++;
  }
  flush();
  return paragraphs;
}

// Above this share of the document, what repeats is the document rather than its
// furniture, and dropping it would delete the content.
const MAX_REPEATED_SHARE = 0.5;

// A header or footer is drawn once on a page, or twice where the same text is set at
// both ends. A line drawn many times on one page is a column of a table repeating its
// own values — a status, a currency, a debit/credit flag — and it looks identical to a
// footer to anything counting pages alone. Dropping it takes a column of data with it.
const MAX_PER_PAGE = 2;

/**
 * The texts that repeat on every page and are page furniture rather than content.
 *
 * Headers and footers repeat verbatim on every page and body text does not, so
 * repetition alone usually identifies them. It stops meaning that when the pages are
 * copies of one template — two tickets from the same order, the same form filled
 * twice — where nearly everything repeats and almost none of it is furniture. A
 * header is a small part of a page, so a repeated share that large is the signal to
 * keep everything.
 *
 * It also stops meaning that within a single page. A table column whose cells hold the
 * same short value on every row repeats as faithfully as any footer, so a line drawn
 * more than MAX_PER_PAGE times on one page is read as content.
 *
 * @param {string[][]} candidates - per page, the texts eligible to be furniture
 * @param {number[]} pageSizes - per page, how many blocks the page holds in total
 * @returns {Set<string>}
 */
function repeatedFurniture(candidates, pageSizes) {
  if (candidates.length < 2) return new Set();

  const counts = new Map();
  const crowded = new Set();
  for (const texts of candidates) {
    const onThisPage = new Map();
    for (const text of texts) onThisPage.set(text, (onThisPage.get(text) || 0) + 1);
    for (const [text, n] of onThisPage) {
      counts.set(text, (counts.get(text) || 0) + 1);
      if (n > MAX_PER_PAGE) crowded.add(text);
    }
  }
  const furniture = new Set(
    [...counts]
      .filter(([text, n]) => n === candidates.length && !crowded.has(text))
      .map(([text]) => text)
  );

  const total = pageSizes.reduce((a, b) => a + b, 0);
  const repeated = candidates.reduce(
    (n, texts) => n + texts.filter(text => furniture.has(text)).length, 0
  );
  return repeated > total * MAX_REPEATED_SHARE ? new Set() : furniture;
}

function dropRepeatedLines(pages) {
  const furniture = repeatedFurniture(pages, pages.map(p => p.length));
  return pages.map(paragraphs => paragraphs.filter(text => !furniture.has(text)));
}

/**
 * Drop page furniture while each line is still a line of its own.
 *
 * Furniture was matched against assembled paragraphs, which holds only while the header
 * stays a paragraph by itself. Where the body starts close under it — a table continued
 * across pages is the ordinary case — assembly joins the two first, the joined text
 * matches no furniture string, and the header survives glued to the front of the first
 * row of every page. Nothing is reported, because nothing was lost: one row per page is
 * simply no longer where a reader, or a parser, looks for it.
 *
 * Matching lines catches it before it can merge. Paragraph-level matching stays for
 * furniture that is a block rather than a line.
 *
 * @param {object[][][]} pageLines - per page, the text items grouped into lines
 * @returns {object[][][]}
 */
function dropFurnitureLines(pageLines) {
  const texts = pageLines.map(lines => lines.map(line => joinOneLine(line).trim()));
  const furniture = repeatedFurniture(texts, texts.map(lines => lines.length));
  if (!furniture.size) return pageLines;
  return pageLines.map((lines, page) => lines.filter((_, i) => !furniture.has(texts[page][i])));
}

// Below this share of page text, the structure tree is not describing the whole
// document and the geometry path is the safer read.
const MIN_STRUCTURE_COVERAGE = 0.6;

/**
 * Read every wanted page once, for both extraction paths.
 *
 * The structure probe used to run over the whole document and the geometry path then
 * re-read every page, so an untagged PDF — the common case — paid for two full passes.
 * Asking for marked content returns the same text items plus the tree's markers, which
 * carry no text and are ignored by everything that reads `str`, so one read serves both.
 *
 * A page that cannot be read is reported and skipped. One corrupt page in a long
 * document used to abort the conversion with a pdf.js stack and no page number, losing
 * the other 199 pages along with it.
 */
async function readPages(doc, keep, filePath) {
  const pages = [];

  for (let n = 1; n <= doc.numPages; n++) {
    if (!keep(n)) continue;
    try {
      const page = await doc.getPage(n);
      const tree = await page.getStructTree().catch(() => null);
      const { items } = await page.getTextContent({ includeMarkedContent: true });
      pages.push({ n, tree, items });
    } catch (err) {
      console.warn(
        `Warning: page ${n} of ${require('path').basename(filePath)} could not be read ` +
        `(${err.message}) — skipping it; the rest of the document is unaffected.`
      );
      pages.push({ n, tree: null, items: [] });
    }
  }
  return pages;
}

/**
 * @param {string} filePath - Path to a PDF
 * @param {object} [opts]
 * @param {Set<number>} [opts.pages] - 1-indexed pages to keep; all pages when absent
 * @returns {Promise<string>} Markdown
 */
async function pdfToMarkdown(filePath, opts = {}) {
  const { pages: wanted = null } = opts;
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({
    url: filePath, useSystemFonts: true, standardFontDataUrl: STANDARD_FONTS,
  }).promise;

  if (wanted) {
    const missing = wanted.beyond(doc.numPages);
    if (missing.length) {
      await doc.cleanup();
      throw new Error(
        `This PDF has ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}; ` +
        `no page ${missing.join(', ')}.`
      );
    }
  }
  const keep = n => !wanted || wanted.has(n);

  const read = await readPages(doc, keep, filePath);
  await doc.cleanup();

  const { structuredMarkdown } = require('./pdf-structure');
  const structured = structuredMarkdown(read);
  if (structured.coverage >= MIN_STRUCTURE_COVERAGE) return structured.markdown;

  // Marked-content markers carry no `str`, so the geometry path skips them the same way
  // it skips anything else without text.
  const pages = dropFurnitureLines(read.map(({ items }) => itemsToLines(items)))
    .map(linesToParagraphs);

  return dropRepeatedLines(pages)
    .map(paragraphs => paragraphs.join('\n\n'))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

module.exports = {
  pdfToMarkdown,
  reorderLtrRuns,
  joinItems,
  repeatedFurniture,
  escapeBlockMarker,
  isRtlText: str => HEBREW_OR_ARABIC.test(str),
  _internals: {
    joinOneLine, linesToParagraphs, orderLines, findGutter, dropRepeatedLines,
    dropFurnitureLines, tableAt, lineToCells, isHeadingLine, lineFontSize, medianFontSize,
  },
};
