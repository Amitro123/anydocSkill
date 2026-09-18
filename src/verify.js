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
const crypto = require('crypto');

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
// Characters that exist on one side only: Markdown a renderer consumes, and the cell
// and bullet marks a renderer adds. Comparing them would report formatting as loss.
const MARKUP = /[*_`#>|~•]/g;
const LEADING_BULLET = /^\s*[-*+•]\s+/;
const HAS_WORD = /[\p{L}\p{N}]/u;
// Markup this tool writes into the Markdown itself. Where there is no PDF to read back,
// the extraction stands in for the page, and its own scaffolding is not page text — the
// slide-notes marker is an HTML comment, which no rendered text can ever contain.
const OWN_MARKUP = /^\s*<!--|^\s*<\/?div\b|^\s*---\s*$/;

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

// An <ol> holding no other <ol>, so a nested list is numbered before the list around it
// and its items are not counted twice.
const INNERMOST_LIST = /<ol([^>]*)>((?:(?!<ol[\s>])[\s\S])*?)<\/ol>/;

/**
 * Write in the numbers a browser would generate for an ordered list.
 *
 * The numbers a reader sees are nowhere in the markup — the browser counts them from
 * the list's `start` — so a renumbered list is invisible to a plain text comparison,
 * which is the one defect this check exists to catch.
 */
function materialiseListNumbers(html) {
  let out = html;

  // Innermost outwards. A numbered item is marked so the list enclosing it skips the
  // items it has already counted rather than numbering them a second time.
  while (INNERMOST_LIST.test(out)) {
    out = out.replace(INNERMOST_LIST, (_, attrs, body) => {
      let n = Number((attrs.match(/start="(\d+)"/) || [])[1] || 1);
      return body.replace(/<li>/g, () => `<li data-numbered>${n++}. `);
    });
  }
  return out;
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

/**
 * Read what a page paints: glyphs that carry no character, and images.
 *
 * Everything else here compares the extracted text against the rendered output, and
 * both of those come from the same text layer — so a glyph that never became a
 * character is missing from both sides and the comparison calls it clean. That is the
 * one kind of loss happening *before* anything this tool does, and the only place it is
 * visible is the operator list, which is what the page actually paints.
 *
 * Counted rather than guessed at from the text: a number printed `.10` because the bank
 * omits the leading zero looks exactly like a truncated one, and reading the output for
 * suspicious shapes would call that a defect. A glyph with no mapping is not a guess.
 *
 * Zero on every document in either corpus — some 55,000 glyphs of Hebrew banking,
 * legal and office output — so this is quiet on healthy files. A font used purely for
 * icons would have unmapped glyphs by design; if that ever surfaces, this is the count
 * to loosen, and the report names it precisely rather than failing silently.
 *
 * Images are counted on the same pass, because they answer the neighbouring question
 * for free: a page that draws one and yields no text is a picture of a page, and its
 * words are not in the text layer for anything here to read or to miss.
 */
function readPage(operatorList, OPS) {
  const paintsImage = new Set([
    OPS.paintImageXObject, OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject, OPS.paintJpegXObject,
  ]);

  let unmapped = 0;
  let images = 0;

  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const op = operatorList.fnArray[i];
    if (paintsImage.has(op)) { images++; continue; }
    if (op !== OPS.showText) continue;

    for (const glyph of operatorList.argsArray[i][0] || []) {
      // A bare number is a positioning adjustment between glyphs, not a glyph.
      if (!glyph || typeof glyph === 'number') continue;
      if (!glyph.unicode || glyph.unicode === '�') unmapped++;
    }
  }
  return { unmapped, images };
}

/**
 * A short content fingerprint for one page of text.
 *
 * Its job is to answer one question across two separate runs: is this the same page text
 * as before? That matters once a second tool is allowed to rewrite the text layer, where
 * the failure to catch is a page that already read correctly being re-guessed. Taken over
 * the normalised text, so whitespace and markup differences do not register as a change
 * while a single different character does. Truncated because 64 bits is far past what
 * distinguishing a few hundred pages needs, and a full hash makes the report unreadable.
 */
const digest = text =>
  crypto.createHash('sha256').update(normalise(text)).digest('hex').slice(0, 16);

async function pdfLines(filePath, wanted) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { _internals: { joinOneLine } } = require('./pdf-extract');
  const doc = await pdfjs.getDocument({ url: filePath, useSystemFonts: true }).promise;

  const pages = [];
  let undecoded = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    if (wanted && !wanted.has(n)) continue;
    const page = await doc.getPage(n);
    const drawn = readPage(await page.getOperatorList(), pdfjs.OPS);
    undecoded += drawn.unmapped;
    const { items } = await page.getTextContent();

    const lines = [];
    let line = [];
    for (const item of items) {
      if (item.str) line.push(item);
      if (item.hasEOL && line.length) { lines.push(line); line = []; }
    }
    if (line.length) lines.push(line);

    const text = lines.map(joinOneLine).filter(Boolean);

    pages.push({
      // The page's own number, not its position in this array. With --pages 5-7 the two
      // differ, and every line reported against the wrong page sends its reader to the
      // wrong place in the document.
      number: n,
      lines: text,
      images: drawn.images,
      undecoded: drawn.unmapped,
      // An image with no text beside it is a page this cannot read at all. Said plainly
      // because it is the one case where OCR would do better, and where saying nothing
      // reads as "there was nothing there".
      picture: drawn.images > 0 && !text.length,
    });
  }
  await doc.cleanup();
  return { pages, undecoded };
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
  const fromPage = path.extname(inputPath).toLowerCase() === '.pdf';
  const read = fromPage
    ? await pdfLines(inputPath, wanted)
    : {
      pages: [{
        number: 1,
        lines: raw.split('\n').filter(line => !OWN_MARKUP.test(line)),
        images: 0, undecoded: 0, picture: false,
      }],
      undecoded: 0,
    };
  const { pages, undecoded } = read;
  const pictures = pages.filter(page => page.picture).map(page => page.number);

  const rendered = renderedText(html);
  const haystack = normalise(rendered);
  const inOutput = new Set(words(rendered));

  // Page furniture is dropped on purpose, so it is reported apart from the losses. The
  // converter's own test decides what counts — including its guard against pages that
  // are copies of one template, where nearly everything repeats and none of it is a
  // header. Judging it any other way here would report a whole document as furniture.
  const furnitureText = repeatedFurniture(
    pages.map(page => page.lines.map(l => l.trim())),
    pages.map(page => page.lines.length)
  );

  const missing = [];
  const reordered = [];
  const furniture = [];
  const kept = [];
  const seen = new Set();

  pages.forEach(page => {
    for (const line of page.lines) {
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

      const where = { page: page.number, text: line.trim() };
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

  // What each page held, kept alongside the findings so a second run over the same
  // document can be compared against this one page by page rather than as a total.
  const detail = pages.map(page => ({
    page: page.number,
    lines: page.lines.length,
    characters: normalise(page.lines.join('')).length,
    digest: digest(page.lines.join('\n')),
    images: page.images,
    undecoded: page.undecoded,
    picture: page.picture,
  }));

  return {
    missing, reordered, furniture, renumbered, undecoded, pictures,
    pages: detail, lines: seen.size, fromPage,
  };
}

const SHOWN = 8;

function report(result, { name }) {
  // Only a PDF can be read back independently. Everywhere else the extraction stands in
  // for the page, which checks that rendering kept what extraction found but cannot
  // speak for extraction itself — so the report says which of the two it did.
  const lines = [result.fromPage
    ? `Verified ${name}: ${result.lines} lines of page text.`
    : `Verified ${name}: ${result.lines} extracted lines reached the output ` +
      `(no page to read back — extraction itself is unchecked).`];

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

  if (result.undecoded) {
    lines.push(`  UNDECODED — ${result.undecoded} glyph(s) the page draws carry no character:`);
    lines.push('    they are absent from the extraction and from the output alike, so nothing');
    lines.push('    else here can see them. The page shows text this conversion does not hold.');
  }

  if (result.pictures && result.pictures.length) {
    const where = result.pictures.length > SHOWN
      ? `${result.pictures.slice(0, SHOWN).join(', ')} and ${result.pictures.length - SHOWN} more`
      : result.pictures.join(', ');
    lines.push(`  PICTURE ONLY — page(s) ${where} draw an image and hold no text.`);
    lines.push('    Their words are not in the text layer, so nothing here can read them');
    lines.push('    or report them missing. OCR the document if those pages matter.');
  }

  // Vacuous where there was no text to lose, and actively misleading next to a page
  // count that says every page was a picture.
  if (passed(result) && result.lines) lines.push('  No text lost, no number changed.');
  return lines.join('\n');
}

/**
 * The same result as a structure a caller can read, rather than a paragraph for a person.
 *
 * `report` above is written to be read once, by someone deciding whether to trust a
 * conversion: it truncates its lists at `SHOWN`, phrases counts as sentences, and buries
 * the page numbers inside them. Anything reading it back has to scrape prose that exists
 * to be readable, and will keep working right up until the wording improves.
 *
 * This is the other half of that interface, and it exists because the document that most
 * needs a second tool is the one this one cannot read. Handing over "pages 4, 7" as text
 * in a sentence makes the handover a parsing problem; handing over `pictureOnly` makes it
 * a field. The per-page digests are here for the return trip: once something else has
 * rewritten the text layer, they are what shows whether the pages that already read
 * correctly still say exactly what they said.
 *
 * `schema` is a promise that a field means what it meant last time. Anything reading this
 * across a version boundary should check it rather than guess.
 */
function reportJson(result, { source }) {
  return {
    schema: 1,
    tool: 'anydoc',
    version: require('../package.json').version,
    source,
    verifiedAt: new Date().toISOString(),
    // False where there was no page to read back, which is the difference between "the
    // output holds what the document holds" and "the output holds what extraction found".
    fromPage: result.fromPage,
    passed: passed(result),
    totals: {
      pages: result.pages.length,
      lines: result.lines,
      undecoded: result.undecoded,
    },
    // The pages nothing here can read, named on their own because they are the reason a
    // caller would be reading this at all.
    pictureOnly: result.pictures,
    pages: result.pages,
    // Untruncated, unlike the prose report: a list cut off at eight is a summary, and
    // a caller comparing two runs needs all of it.
    findings: {
      missing: result.missing,
      reordered: result.reordered,
      furniture: result.furniture,
      renumbered: result.renumbered,
    },
  };
}

// A glyph the page draws and the text layer never yielded is text the reader can see
// and the output cannot hold, which is the same loss as any other — so it fails the
// same way rather than being reported as a note under a clean verdict.
const passed = result =>
  !result.missing.length && !result.renumbered.length && !result.undecoded;

module.exports = {
  verify, report, reportJson, passed,
  _internals: { renderedText, numberCounts, normalise, readPage, digest },
};
