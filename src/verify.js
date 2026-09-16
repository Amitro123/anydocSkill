/**
 * Check that the text a document holds is the text its conversion renders.
 *
 * Every defect this converter has had was mechanically visible: a line the page showed
 * and the output did not, or a number the reader sees changed. Finding them meant
 * reading a converted document against its original by eye, which does not scale past
 * the document in front of you and misses exactly the quiet ones — a dropped footer, a
 * clause renumbered by one.
 *
 * So the same comparison is done here. The source of truth is the page text read
 * straight from the PDF, and the other side is the finished HTML turned back into the
 * words a reader would see — which is the only place a Markdown marker that was read
 * back as markup, or a list a renderer renumbered, becomes visible again.
 *
 * What this does not check: how words were assembled from the glyphs, since it reads
 * lines through the same joining the converter does. It checks that the lines the
 * extractor read reach the reader intact.
 */

const path = require('path');

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
// Characters that exist on one side only: Markdown a renderer consumes, and the cell
// and bullet marks a renderer adds. Comparing them would report formatting as loss.
const MARKUP = /[*_`#>|~•]/g;
const LEADING_BULLET = /^\s*[-*+•]\s+/;
const HAS_WORD = /[\p{L}\p{N}]/u;

const normalise = str =>
  str.normalize('NFC').replace(BIDI, '').replace(MARKUP, '').replace(/\s+/g, '');

const words = str =>
  str.normalize('NFC').replace(BIDI, '').replace(MARKUP, ' ').split(/\s+/).filter(Boolean);

function decodeEntities(html) {
  return html
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// A browser numbers an <ol> itself, so the numbers a reader sees are nowhere in the
// markup. Writing them in is what makes a renumbered list comparable to the page.
function materialiseListNumbers(html) {
  return html.replace(/<ol([^>]*)>([\s\S]*?)<\/ol>/g, (_, attrs, body) => {
    let n = Number((attrs.match(/start="(\d+)"/) || [])[1] || 1);
    return body.replace(/<li>/g, () => `<li>${n++}. `);
  });
}

function renderedText(html) {
  const main = (html.match(/<main>([\s\S]*)<\/main>/) || [])[1] || html;
  return decodeEntities(materialiseListNumbers(main).replace(/<[^>]+>/g, ' '));
}

// Counted rather than listed: a renumbered run keeps using numbers the document
// already contains, and only their tallies give it away.
function numberCounts(text) {
  const counts = new Map();
  for (const [match] of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    counts.set(match, (counts.get(match) || 0) + 1);
  }
  return counts;
}

async function pdfLines(filePath, wanted) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { _internals: { joinOneLine } } = require('./pdf-extract');
  const doc = await pdfjs.getDocument({ url: filePath, useSystemFonts: true }).promise;

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (wanted && !wanted.has(n)) continue;
    const { items } = await doc.getPage(n).then(p => p.getTextContent());

    const lines = [];
    let line = [];
    for (const item of items) {
      if (item.str) line.push(item);
      if (item.hasEOL && line.length) { lines.push(line); line = []; }
    }
    if (line.length) lines.push(line);

    pages.push(lines.map(joinOneLine).filter(Boolean));
  }
  await doc.cleanup();
  return pages;
}

/**
 * @param {string} inputPath - The document that was converted
 * @param {object} opts
 * @param {string} opts.raw - Markdown as extracted, used where the source cannot be re-read
 * @param {string} opts.html - The rendered HTML
 * @param {Set<number>} [opts.pages] - The pages that were converted, if not all of them
 * @returns {Promise<{missing: object[], furniture: object[], renumbered: object[], lines: number}>}
 */
async function verify(inputPath, { raw, html, pages: wanted = null }) {
  const { repeatedFurniture } = require('./pdf-extract');
  const pages = path.extname(inputPath).toLowerCase() === '.pdf'
    ? await pdfLines(inputPath, wanted)
    : [raw.split('\n')];

  const rendered = renderedText(html);
  const haystack = normalise(rendered);
  const inOutput = new Set(words(rendered));

  // Page furniture is dropped on purpose, so it is reported apart from the losses. The
  // converter's own test decides what counts — including its guard against pages that
  // are copies of one template, where nearly everything repeats and none of it is a
  // header. Judging it any other way here would report a whole document as furniture.
  const furnitureText = repeatedFurniture(
    pages.map(lines => lines.map(l => l.trim())),
    pages.map(lines => lines.length)
  );

  const missing = [];
  const reordered = [];
  const furniture = [];
  const kept = [];
  const seen = new Set();

  pages.forEach((lines, i) => {
    for (const line of lines) {
      // A line the page draws as a bullet loses its mark to the renderer's own.
      const text = line.replace(LEADING_BULLET, '');
      const key = normalise(text);
      // Rules and other pure punctuation carry nothing a reader would miss.
      if (!key || !HAS_WORD.test(key)) continue;

      const isFurniture = furnitureText.has(line.trim());
      if (!isFurniture) kept.push(text);
      if (seen.has(key)) continue;
      seen.add(key);
      if (haystack.includes(key)) continue;

      const where = { page: i + 1, text: line.trim() };
      if (isFurniture) furniture.push(where);
      // Cells read across a table row in a different order than down a page line, so
      // a line whose every word is present is rearranged rather than lost.
      else if (words(text).every(w => inOutput.has(w))) reordered.push(where);
      else missing.push(where);
    }
  });

  const before = numberCounts(kept.join('\n'));
  const after = numberCounts(rendered);
  const renumbered = [];
  for (const value of new Set([...before.keys(), ...after.keys()])) {
    const source = before.get(value) || 0;
    const output = after.get(value) || 0;
    if (source !== output) renumbered.push({ value, source, output });
  }

  return { missing, reordered, furniture, renumbered, lines: seen.size };
}

const SHOWN = 8;

function report(result, { name }) {
  const lines = [`Verified ${name}: ${result.lines} lines of page text.`];

  if (result.furniture.length) {
    lines.push(`  ${result.furniture.length} repeated header/footer line(s) dropped, as intended:`);
    lines.push(...result.furniture.slice(0, SHOWN).map(m => `    ${m.text}`));
  }

  if (result.reordered.length) {
    lines.push(`  ${result.reordered.length} line(s) kept every word but changed order, most likely a table row:`);
    lines.push(...result.reordered.slice(0, SHOWN).map(m => `    p${m.page}: ${m.text}`));
  }

  if (result.missing.length) {
    lines.push(`  MISSING — ${result.missing.length} line(s) on the page are not in the output:`);
    lines.push(...result.missing.slice(0, SHOWN).map(m => `    p${m.page}: ${m.text}`));
    if (result.missing.length > SHOWN) lines.push(`    ... and ${result.missing.length - SHOWN} more`);
  }

  if (result.renumbered.length) {
    lines.push(`  CHANGED — ${result.renumbered.length} number(s) appear a different number of times:`);
    lines.push(...result.renumbered.slice(0, SHOWN).map(
      c => `    "${c.value}" — ${c.source}x on the page, ${c.output}x in the output`));
    if (result.renumbered.length > SHOWN) lines.push(`    ... and ${result.renumbered.length - SHOWN} more`);
  }

  if (!result.missing.length && !result.renumbered.length) lines.push('  No text lost, no number changed.');
  return lines.join('\n');
}

const passed = result => !result.missing.length && !result.renumbered.length;

module.exports = { verify, report, passed, _internals: { renderedText, numberCounts, normalise } };
