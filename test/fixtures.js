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

const PDF_LINES = [
  [72, 720, 'Mediation Agreement'],
  [72, 700, 'Case number 123456-01-26'],
  [72, 660, 'The parties agree to cooperate in good faith.'],
];

/**
 * Reorder a page's text operators without moving any of it on the page.
 *
 * Producers disagree about emission order, and every ordering bug found so far came
 * from code trusting that order. A fixture that only ever emits top to bottom cannot
 * surface the next one, so the tests convert the same page emitted several ways and
 * require identical output.
 */
const EMISSION_ORDERS = {
  document: lines => lines,                                  // top to bottom
  reversed: lines => [...lines].reverse(),                   // bottom to top
  scrambled: lines => [lines[1], lines[2], lines[0]],        // middle, bottom, top
};

/**
 * A minimal untagged PDF using a standard font, which needs no embedding.
 *
 * Latin-only: Hebrew in a PDF requires an embedded font, and building one here would
 * test the fixture more than the extractor. This exercises the geometry path — line
 * grouping, gap-based word spacing, paragraph breaks — which is what has no other
 * end-to-end coverage.
 *
 * @param {object} [opts]
 * @param {keyof EMISSION_ORDERS} [opts.order='document'] - Order to emit the text in
 */
function writePdf(dir, { order = 'document' } = {}) {
  const lines = EMISSION_ORDERS[order](PDF_LINES);
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

  const file = path.join(dir, `doc-${order}.pdf`);
  fs.writeFileSync(file, pdf, 'latin1');
  return file;
}

/**
 * A PDF of several pages, each naming its own number.
 *
 * --pages selects by page, so the thing worth asserting is that page N comes back
 * with page N's words on it. A single-page fixture can only show that the output got
 * shorter, which an off-by-one would satisfy just as well.
 *
 * @param {number} [count=3] - How many pages to write
 */
function writeMultiPagePdf(dir, count = 3) {
  const body = n => `Page ${n} of ${count}. Section ${'ABCDEFGH'[n - 1]} begins here.`;

  const streams = [];
  for (let n = 1; n <= count; n++) {
    streams.push(`BT /F1 12 Tf 72 720 Td (${body(n)}) Tj ET`);
  }

  // Object layout: 1 catalog, 2 pages, 3 font, then a page and a stream per sheet.
  const pageId = n => 4 + (n - 1) * 2;
  const objects = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[${Array.from({ length: count }, (_, i) => `${pageId(i + 1)} 0 R`).join(' ')}]/Count ${count}>>`,
    `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`,
  ];
  for (let n = 1; n <= count; n++) {
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]` +
      `/Resources<</Font<</F1 3 0 R>>>>/Contents ${pageId(n) + 1} 0 R>>`,
      `<</Length ${streams[n - 1].length}>>\nstream\n${streams[n - 1]}\nendstream`
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;

  const file = path.join(dir, `pages-${count}.pdf`);
  fs.writeFileSync(file, pdf, 'latin1');
  return file;
}

/**
 * A PDF built from explicit page contents, so a test can pose the exact page shape a
 * real document used to break the converter with.
 *
 * @param {string[][]} pages - Per page, `[x, y, text]` triples
 */
function writeLaidOutPdf(dir, pages, name) {
  const streams = pages.map(lines => lines
    .map(([x, y, text]) => `BT /F1 10 Tf ${x} ${y} Td (${text}) Tj ET`)
    .join('\n'));

  const pageId = n => 4 + (n - 1) * 2;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${pages.map((_, i) => `${pageId(i + 1)} 0 R`).join(' ')}]/Count ${pages.length}>>`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  streams.forEach(stream => objects.push(
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R>>>>` +
    `/Contents ${objects.length + 2} 0 R>>`,
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`
  ));

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;

  const file = path.join(dir, `${name}.pdf`);
  fs.writeFileSync(file, pdf, 'latin1');
  return file;
}

// Text placed past the right edge of the MediaBox is clipped before it ever reaches
// the extractor, which silently truncates a fixture's lines. Helvetica at 10pt runs to
// roughly this, so a line is kept inside the page.
const CHARS_PER_LINE = 48;

// An invoice: a table whose first column is headed "#", a footer written between
// dashes, and a line of prose that must not be swept into the table.
const writeInvoicePdf = dir => writeLaidOutPdf(dir, [[
  [72, 720, 'Invoice 40243'],
  [72, 640, '#'], [110, 640, 'Item'], [300, 640, 'Qty'], [430, 640, 'Total'],
  [72, 620, '1'], [110, 620, 'Consulting'], [300, 620, '1.00'], [430, 620, '1,200.00'],
  [72, 560, 'Thank you for your business.'],
  [72, 60, '- page 1 -'],
]], 'invoice');

/**
 * A statement whose table runs across pages: the column header repeats at the top of
 * every page, and the first row sits directly under it at the body's own line spacing.
 *
 * This is the shape that used to glue the header onto the front of the first row of
 * each page. Paragraph assembly joined the two before furniture matching ever saw the
 * header as a line of its own, so it matched nothing and survived.
 */
function writeStatementPdf(dir, pageCount = 3) {
  const page = n => [
    [72, 700, 'Date Description Debit Credit Balance'],
    ...Array.from({ length: 5 }, (_, i) =>
      [72, 675 - i * 25, `0${n}/09/2026 Payee ${n}${i} 1,${n}${i}0.00 2`]),
  ];
  return writeLaidOutPdf(dir, Array.from({ length: pageCount }, (_, i) => page(i + 1)), 'statement');
}

/**
 * Two columns under a running header that spans the full width of the page.
 *
 * Columns are only split at a gutter no line crosses, and a full-width header crosses
 * every candidate — so while the header is still on the page there is no gutter to
 * find, and sorting by y alone reads the two columns interleaved a line at a time.
 * Dropping the header first leaves the gutter clear.
 *
 * The header has to repeat on every page to be recognised as furniture at all, which
 * is also how a running header behaves.
 */
function writeRunningHeaderColumnsPdf(dir, pageCount = 3) {
  const left = ['North opened sites', 'and hired staff', 'across the region'];
  const right = ['South closed one', 'and moved people', 'north for the year'];

  const page = n => [
    [72, 730, 'QUARTERLY REPORT - CONFIDENTIAL - ALL DIVISIONS'],
    ...left.map((text, i) => [72, 690 - i * 14, `${text} ${n}`]),
    ...right.map((text, i) => [330, 690 - i * 14, `${text} ${n}`]),
  ];

  return writeLaidOutPdf(
    dir, Array.from({ length: pageCount }, (_, i) => page(i + 1)), 'running-header-columns');
}

/**
 * Two tickets from one order.
 *
 * The pages are copies of a template, so nearly everything on them repeats and none of
 * it is a header. A fixture with only a line or two in common would not pose that: the
 * filter is meant to drop the lines that repeat, and only the share of the page they
 * cover says this is a template rather than furniture.
 */
function writeTicketsPdf(dir) {
  const shared = [
    'Ticket number', 'Order ATC-4471', 'Payment status', 'Paid',
    'Saturday at the park', '15 August 2026, 09:00 to 12:30',
    'Park entrance, Gate B', 'Please show this ticket on arrival',
  ];
  const page = (code, admission) => [
    ...shared.map((text, i) => [72, 720 - i * 40, text]),
    [72, 720 - shared.length * 40, code],
    [72, 680 - shared.length * 40, admission],
  ];

  return writeLaidOutPdf(dir,
    [page('AAAA-1111', 'Adult admission'), page('BBBB-2222', 'Child admission')],
    'tickets');
}

/**
 * A letter numbering its sections and its clauses separately.
 *
 * The run reads 1, 1, 2, 3, so a renderer counting from the first number prints
 * 1, 2, 3, 4 and shifts every clause. Each clause wraps onto a second line so the
 * paragraph detector has a body gap to measure and keeps the clauses apart.
 */
function writeNumberedPdf(dir) {
  // Paragraphs are inferred from line gaps, so most gaps have to be the within-clause
  // one for the between-clause gap to stand out against it. Each clause therefore wraps
  // onto three lines, as a real clause does.
  const blocks = [
    ['1. Background to this letter'],
    ['1. On 6 March your recruiter first wrote', 'to our client about the role, and', 'a meeting followed that week.'],
    ['2. An agreement was signed on the', '14th of April, setting out the', 'position and the start date.'],
    ['3. The start date was 11 May, and', 'our client gave notice at his', 'previous employer the same day.'],
  ];

  const lines = [];
  let y = 720;
  for (const block of blocks) {
    for (const text of block) {
      lines.push([72, y, text.slice(0, CHARS_PER_LINE)]);
      y -= 14;
    }
    y -= 32;
  }
  return writeLaidOutPdf(dir, [lines], 'numbered');
}

/**
 * A page in two columns, with a line of full-width text above them.
 *
 * Sorting a page like this by y alone interleaves the columns line by line. The gutter
 * has to be found and each column read through, which has no other end-to-end cover.
 */
const writeTwoColumnPdf = dir => writeLaidOutPdf(dir, [[
  [72, 720, 'Quarterly report, both divisions'],
  ...['North opened two sites', 'in the first quarter, and', 'hired eleven people.']
    .map((text, i) => [72, 660 - i * 14, text]),
  ...['South closed one site', 'over the same period and', 'moved four people north.']
    .map((text, i) => [330, 660 - i * 14, text]),
]], 'two-column');

/**
 * The documents the committed corpus converts.
 *
 * Each is a page shape that broke a real conversion or that nothing else covers
 * end-to-end. They are generated rather than committed so the suite carries no real
 * document, and so what is under test is readable here rather than hidden in a binary.
 */
function writeCorpus(dir) {
  return [
    writeInvoicePdf(dir),
    writeTicketsPdf(dir),
    writeNumberedPdf(dir),
    writeTwoColumnPdf(dir),
    writePdf(dir),
    writeMultiPagePdf(dir, 3),
    writePptx(dir),
    writeXlsx(dir),
    writeCsv(dir),
    writeOdt(dir),
  ];
}

module.exports = {
  HEBREW, tempDir, EMISSION_ORDERS, writeTwoColumnPdf, writeCorpus,
  writeCsv, writeTxt, writeRtf, writeXlsx, writeOdt, writePptx, writePdf,
  writeMultiPagePdf, writeLaidOutPdf, writeInvoicePdf, writeTicketsPdf, writeNumberedPdf,
  writeStatementPdf, writeRunningHeaderColumnsPdf,
};
