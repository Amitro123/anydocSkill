/**
 * Write a corrected page from an OCR transcript, and assemble the final PDF from it.
 *
 * ocrmypdf's own output PDF is not used for its text. Its embedded OCR text layer is
 * exactly the thing that came back character-reversed on real Hebrew scans — not a
 * Tesseract recognition error, but something that goes wrong specifically in how
 * ocrmypdf writes that recognition into the page's content stream. Its `--sidecar`
 * transcript is a different code path — Tesseract's own plain-text output, ahead of
 * whatever ocrmypdf's embedding step does to it — and came back correct on every page
 * checked against this. So the fix here is not to detect and reverse a known-bad
 * pattern; it is to never read the broken text in the first place, and draw the
 * transcript onto a fresh page of our own instead.
 *
 * That page does not need to look right, only to extract right. Nothing downstream of
 * `ocrmypdf` in this project renders a page — every consumer (pdf-extract.js,
 * verify.js) calls pdf.js's getTextContent(), which reads the string a Tj/TJ operator
 * draws in the order it was written, independent of how the glyphs are laid out
 * visually. Text is drawn left to right here for exactly that reason: an RTL reader
 * opening the file by hand would see it laid out wrong, but nothing here ever does.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_SIZE = 12;
const LINE_HEIGHT = FONT_SIZE * 1.4;
const MARGIN = 48;

/**
 * Split a transcript line into pieces no wider than the page, breaking on spaces.
 *
 * Tesseract's own line breaks are kept as paragraph breaks; this only wraps a single
 * recognized line that would otherwise run off the page, which is rare (transcripts
 * come pre-broken into short lines) but not impossible on a dense page.
 */
function wrap(font, line, maxWidth) {
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const rows = [];
  let row = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${row} ${word}`;
    if (font.widthOfTextAtSize(candidate, FONT_SIZE) <= maxWidth) {
      row = candidate;
    } else {
      rows.push(row);
      row = word;
    }
  }
  rows.push(row);
  return rows;
}

/**
 * Build a PDF with one page per entry, each sized to match the page it stands in for
 * and holding that page's corrected OCR text.
 *
 * @param {{width: number, height: number, text: string}[]} pages
 * @returns {Promise<Uint8Array>}
 */
async function buildCorrectedPdf(pages) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(FONT_PATH), { subset: true });

  for (const { width, height, text } of pages) {
    const page = doc.addPage([width, height]);
    const maxWidth = Math.max(width - MARGIN * 2, 1);

    let y = height - MARGIN;
    // Tesseract's own paragraph/line breaks are the only structure a transcript has;
    // kept as-is rather than re-flowed, since re-flowing could merge two lines that
    // were meaningfully separate (a heading and its body, two list items).
    for (const line of text.split('\n')) {
      for (const row of wrap(font, line, maxWidth)) {
        if (y < MARGIN) break; // more text than the page has room for; rare, not fatal
        if (row) page.drawText(row, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
        y -= LINE_HEIGHT;
      }
    }
  }

  return doc.save();
}

/**
 * Assemble the final PDF: the original document's own pages everywhere except the
 * pages OCR was asked to recover, which come from the freshly built corrected PDF.
 *
 * This is the step reconcile.js's page-by-page digest check is written to trust: every
 * page not in `pictureOnly` is a structural copy of the original page's own PDF
 * objects, not a re-extraction or a re-render of anything, so there is nothing here
 * that could change what those pages say.
 *
 * @param {string} originalPath
 * @param {Uint8Array} correctedBytes - from buildCorrectedPdf(), one page per pictureOnly entry
 * @param {number[]} pictureOnly - 1-indexed page numbers, in the same order as correctedBytes' pages
 * @returns {Promise<Uint8Array>}
 */
async function assembleFinalPdf(originalPath, correctedBytes, pictureOnly) {
  const original = await PDFDocument.load(fs.readFileSync(originalPath));
  const corrected = await PDFDocument.load(correctedBytes);
  const final = await PDFDocument.create();

  const pageCount = original.getPageCount();
  const correctedIndexOf = new Map(pictureOnly.map((page, i) => [page, i]));

  for (let n = 1; n <= pageCount; n++) {
    const fromCorrected = correctedIndexOf.has(n);
    const [copied] = await final.copyPages(
      fromCorrected ? corrected : original,
      [fromCorrected ? correctedIndexOf.get(n) : n - 1]
    );
    final.addPage(copied);
  }

  return final.save();
}

module.exports = { buildCorrectedPdf, assembleFinalPdf, _internals: { wrap, FONT_PATH } };
