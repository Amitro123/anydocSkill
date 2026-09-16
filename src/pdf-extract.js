/**
 * PDF → Markdown via pdf.js.
 *
 * anydoc's PDF path emits Hebrew in visual order (every word character-reversed),
 * which cannot be repaired downstream. pdf.js returns text items already in logical
 * reading order, so this module reconstructs lines and paragraphs from item geometry
 * instead.
 *
 * Deliberately conservative: paragraphs and line breaks only. Source numbering
 * ("1.", ".1") is left as literal text rather than converted to Markdown lists, so
 * clause numbers in legal documents are never silently renumbered.
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

// Items arrive in reading order, so a gap is the gap between neighbouring boxes
// regardless of direction.
function joinLine(items) {
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

function linesToParagraphs(lines) {
  const body = medianGap(lines);
  const column = columnWidth(lines);
  const paragraphs = [];
  let current = [];

  const flush = () => {
    if (current.length) paragraphs.push(current.join(' '));
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const text = joinLine(lines[i]);
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

/**
 * @param {string} filePath - Path to a PDF
 * @returns {Promise<string>} Markdown
 */
async function pdfToMarkdown(filePath) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ url: filePath, useSystemFonts: true }).promise;

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
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

module.exports = { pdfToMarkdown };
