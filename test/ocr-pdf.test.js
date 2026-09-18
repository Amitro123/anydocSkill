/**
 * src/ocr-pdf.js: the corrected page built from an OCR transcript, and the assembly
 * that keeps every other page byte-identical to the original.
 *
 * A separate file, not folded into src/rtl.test.js, because pdf-lib's API is async and
 * that file runs top to bottom synchronously — an async check dropped in among it would
 * race its final "All tests passed." rather than being awaited by it, which is exactly
 * the mistake this file exists to avoid repeating.
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const STANDARD_FONTS = `${path.join(
  require.resolve('pdfjs-dist/package.json'), '..', 'standard_fonts')}/`;

(async () => {
  const { buildCorrectedPdf, assembleFinalPdf, _internals } = require('../src/ocr-pdf');
  const { writeMixedPdf, tempDir } = require('./fixtures');
  const { verify } = require('../src/verify');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const dir = tempDir();
  const PAGE1 = 'The parties agree to cooperate in good faith.';
  const original = writeMixedPdf(dir, [PAGE1, null], 'mixed.pdf');

  // The text a corrected page holds must read back exactly as written — no BiDi
  // reordering, no reversal, nothing lost — since it is already in the order the OCR
  // transcript gave it, and pdf.js is a reader, not a script-aware renderer.
  const TEXT = 'אני כבר ילדה גדולה\nשעולה לגן של גדולים';
  const correctedBytes = await buildCorrectedPdf([{ width: 612, height: 792, text: TEXT }]);
  const finalBytes = await assembleFinalPdf(original, correctedBytes, [2]);
  const finalPath = dir + '/final.pdf';
  fs.writeFileSync(finalPath, finalBytes);

  const { _internals: verifyInternals } = require('../src/verify');
  const doc = await pdfjs.getDocument({ url: finalPath, standardFontDataUrl: STANDARD_FONTS }).promise;
  assert.strictEqual(doc.numPages, 2, 'the merged document keeps the original page count');

  const page1 = await (await doc.getPage(1)).getTextContent();
  assert.strictEqual(page1.items.map(i => i.str).join(' '), PAGE1,
    'the untouched page reads exactly as it always did');

  const page2 = await (await doc.getPage(2)).getTextContent();
  assert.strictEqual(page2.items.map(i => i.str).join(' ').replace(/\s+/g, ' '),
    TEXT.replace(/\n/g, ' '),
    'the corrected page reads back the transcript, in the order it was given — not reversed');

  // The property reconcile.js actually depends on: a page assembleFinalPdf did not
  // touch must verify to the exact same digest as reading the original file alone.
  const fromOriginal = await verify(original, { raw: '', html: '<main></main>' });
  const fromFinal = await verify(finalPath, { raw: '', html: '<main></main>' });
  assert.strictEqual(fromFinal.pages[0].digest, fromOriginal.pages[0].digest,
    'a page not named in pictureOnly must verify identically before and after assembly');

  // Two pages recovered, at their own original sizes, in the right order.
  const twoUp = await buildCorrectedPdf([
    { width: 300, height: 400, text: 'א' },
    { width: 600, height: 900, text: 'ב' },
  ]);
  const merged = await assembleFinalPdf(original, twoUp, [1, 2]);
  const mergedPath = dir + '/two.pdf';
  fs.writeFileSync(mergedPath, merged);
  const twoDoc = await pdfjs.getDocument({ url: mergedPath, standardFontDataUrl: STANDARD_FONTS }).promise;
  const v1 = (await twoDoc.getPage(1)).view, v2 = (await twoDoc.getPage(2)).view;
  assert.strictEqual(v1[2], 300, 'page 1 takes the size passed for it, not a default');
  assert.strictEqual(v2[2], 600, 'page 2 keeps its own, different size');

  // Wrapping: kept, not merged, since two transcript lines can be meaningfully distinct
  // (a heading and its body) and joining them would lose that.
  const { PDFDocument } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const probe = await PDFDocument.create();
  probe.registerFontkit(fontkit);
  const font = await probe.embedFont(fs.readFileSync(_internals.FONT_PATH), { subset: true });

  assert.deepStrictEqual(_internals.wrap(font, '', 400), ['']);
  assert.deepStrictEqual(_internals.wrap(font, 'one two', 400), ['one two']);
  const long = 'a very long line of text that will definitely need to wrap across more rows';
  const wrapped = _internals.wrap(font, long, 200);
  assert(wrapped.length > 1, 'a line wider than the page splits into more than one row');
  assert.strictEqual(wrapped.join(' '), long, 'and wrapping loses no words');

  console.log('All ocr-pdf tests passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
