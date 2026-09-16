/**
 * PDF → Markdown via pdf.js.
 *
 * anydoc's PDF path emits Hebrew in visual order (every word character-reversed),
 * which cannot be repaired downstream. pdf.js returns text items already in logical
 * reading order, so this module reconstructs lines and paragraphs from item geometry
 * instead.
 *
 * A tagged PDF is read through pdf-structure.js, which uses the document's own
 * structure tree. This geometry path is the fallback for untagged PDFs: it infers
 * paragraphs from line gaps and line widths, and leaves source numbering as literal
 * text so clause numbers in legal documents are never silently renumbered.
 */

const PARAGRAPH_GAP_RATIO = 1.6;  // line gap beyond this multiple of the body gap starts a paragraph
const SHORT_LINE_RATIO = 0.75;    // a line narrower than this fraction of the column ends a paragraph

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

function lineY(items) {
  return items[0].transform[5];
}

function lineWidth(items) {
  let left = Infinity, right = -Infinity;
  for (const item of items) {
    left = Math.min(left, item.transform[4]);
    right = Math.max(right, item.transform[4] + (item.width || 0));
  }
  return right - left;
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

function linesToParagraphs(rawLines) {
  // Producers do not always emit a page top to bottom: a newsletter exported from a
  // mail tool put its middle section first, then the footer, then the header. Array
  // order is not document order any more than it is reading order within a line, so
  // lines are placed by their own y. A page already emitted in order is unchanged.
  const lines = [...rawLines].sort((a, b) => lineY(b) - lineY(a));
  const body = medianGap(lines);
  const column = columnWidth(lines);
  const paragraphs = [];
  let current = [];

  const flush = () => {
    if (current.length) paragraphs.push(current.join(' '));
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const text = joinOneLine(lines[i]);
    if (!text) continue;

    if (i > 0 && body > 0) {
      const gap = lineY(lines[i - 1]) - lineY(lines[i]);
      if (gap > body * PARAGRAPH_GAP_RATIO || gap < 0) flush();
    }

    current.push(text);
    if (column > 0 && lineWidth(lines[i]) < column * SHORT_LINE_RATIO) flush();
  }
  flush();
  return paragraphs;
}

// Headers and footers repeat verbatim on every page; body text does not.
function dropRepeatedLines(pages) {
  if (pages.length < 2) return pages;

  const counts = new Map();
  for (const paragraphs of pages) {
    for (const text of new Set(paragraphs)) {
      counts.set(text, (counts.get(text) || 0) + 1);
    }
  }
  return pages.map(paragraphs =>
    paragraphs.filter(text => counts.get(text) < pages.length)
  );
}

// Below this share of page text, the structure tree is not describing the whole
// document and the geometry path is the safer read.
const MIN_STRUCTURE_COVERAGE = 0.6;

/**
 * @param {string} filePath - Path to a PDF
 * @param {object} [opts]
 * @param {Set<number>} [opts.pages] - 1-indexed pages to keep; all pages when absent
 * @returns {Promise<string>} Markdown
 */
async function pdfToMarkdown(filePath, opts = {}) {
  const { pages: wanted = null } = opts;
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ url: filePath, useSystemFonts: true }).promise;

  if (wanted) {
    const missing = [...wanted].filter(n => n < 1 || n > doc.numPages);
    if (missing.length) {
      await doc.cleanup();
      throw new Error(
        `This PDF has ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}; ` +
        `no page ${missing.join(', ')}.`
      );
    }
  }
  const keep = n => !wanted || wanted.has(n);

  const { structuredMarkdown } = require('./pdf-structure');
  const structured = await structuredMarkdown(doc, keep);
  if (structured.coverage >= MIN_STRUCTURE_COVERAGE) {
    await doc.cleanup();
    return structured.markdown;
  }

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (!keep(n)) continue;
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    pages.push(linesToParagraphs(itemsToLines(items)));
  }
  await doc.cleanup();

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
  isRtlText: str => HEBREW_OR_ARABIC.test(str),
  _internals: { joinOneLine, linesToParagraphs },
};
