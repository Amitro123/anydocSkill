/**
 * Builds small documents to convert in the integration tests.
 *
 * Fixtures are generated rather than committed so the suite never carries real
 * documents, and so the Hebrew content under test is visible in this file rather
 * than hidden inside a binary.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const HEBREW = {
  title: 'הסכם כניסה להליך גישור',
  party: 'ישראל ישראלי, ת.ז. 123456789',
  amount: 'סך של 1,300 ש"ח',
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'anydoc-test-'));
}

function writeCsv(dir) {
  const file = path.join(dir, 'table.csv');
  fs.writeFileSync(file, 'שם,ת.ז,סכום\nישראל ישראלי,123456789,"1,300"\n', 'utf8');
  return file;
}

function writeTxt(dir) {
  const file = path.join(dir, 'note.txt');
  fs.writeFileSync(file, `${HEBREW.title}\n\n${HEBREW.party}\n`, 'utf8');
  return file;
}

function writeRtf(dir) {
  const file = path.join(dir, 'doc.rtf');
  const esc = str => [...str].map(c => (c.codePointAt(0) > 127 ? `\\u${c.codePointAt(0)}?` : c)).join('');
  fs.writeFileSync(file,
    `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\n` +
    `{\\rtlch\\f0\\fs24 ${esc(HEBREW.title)}\\par}\n` +
    `{\\rtlch\\f0\\fs24 ${esc(HEBREW.party)}\\par}\n}`, 'latin1');
  return file;
}

function writeXlsx(dir) {
  const rows = [['שם', 'ת.ז', 'סכום'], ['ישראל ישראלי', '123456789', '1,300']];
  const sheet = rows.map((row, i) =>
    `<row r="${i + 1}">${row.map((v, j) =>
      `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${v}</t></is></c>`
    ).join('')}</row>`).join('');

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
  zip.addFile('_rels/.rels', Buffer.from(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`));
  zip.addFile('xl/workbook.xml', Buffer.from(
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="גיליון1" sheetId="1" r:id="rId1"/></sheets></workbook>`));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`));

  const file = path.join(dir, 'book.xlsx');
  zip.writeZip(file);
  return file;
}

function writeOdt(dir) {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.text'));
  zip.addFile('META-INF/manifest.xml', Buffer.from(
    `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>` +
    `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`));
  zip.addFile('content.xml', Buffer.from(
    `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
    `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text>` +
    `<text:h text:outline-level="1">${HEBREW.title}</text:h>` +
    `<text:p>${HEBREW.party}</text:p><text:p>${HEBREW.amount}</text:p>` +
    `</office:text></office:body></office:document-content>`));

  const file = path.join(dir, 'doc.odt');
  zip.writeZip(file);
  return file;
}

/**
 * A deck carrying only the parts pptx-extract reads: the slide parts, plus a notes
 * part with the slide-number placeholder that must not leak into the output.
 */
function writePptx(dir, { hebrew = true } = {}) {
  const text = hebrew
    ? [HEBREW.title, HEBREW.party]
    : ['Quarterly Review', 'Revenue is up'];

  const slide = body =>
    `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>` +
    `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
    `<p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr>` +
    `<p:txBody><a:p><a:fld><a:t>99</a:t></a:fld></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`;

  const zip = new AdmZip();
  text.forEach((body, i) => zip.addFile(`ppt/slides/slide${i + 1}.xml`, Buffer.from(slide(body))));
  zip.addFile('ppt/notesSlides/notesSlide1.xml', Buffer.from(
    `<?xml version="1.0"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>` +
    `<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>` +
    `<p:txBody><a:p><a:r><a:t>${hebrew ? 'להזכיר את התקציב' : 'Mention the budget'}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr>` +
    `<p:txBody><a:p><a:fld><a:t>2</a:t></a:fld></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:notes>`));

  const file = path.join(dir, hebrew ? 'deck.pptx' : 'deck-en.pptx');
  zip.writeZip(file);
  return file;
}

/**
 * A minimal untagged PDF using a standard font, which needs no embedding.
 *
 * Latin-only: Hebrew in a PDF requires an embedded font, and building one here would
 * test the fixture more than the extractor. This exercises the geometry path — line
 * grouping, gap-based word spacing, paragraph breaks — which is what has no other
 * end-to-end coverage.
 */
function writePdf(dir) {
  const lines = [
    [72, 720, 'Mediation Agreement'],
    [72, 700, 'Case number 123456-01-26'],
    [72, 660, 'The parties agree to cooperate in good faith.'],
  ];
  const content = lines
    .map(([x, y, text]) => `BT /F1 12 Tf ${x} ${y} Td (${text}) Tj ET`)
    .join('\n');

  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;

  const file = path.join(dir, 'doc.pdf');
  fs.writeFileSync(file, pdf, 'latin1');
  return file;
}

module.exports = {
  HEBREW, tempDir,
  writeCsv, writeTxt, writeRtf, writeXlsx, writeOdt, writePptx, writePdf,
};
