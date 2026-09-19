/**
 * PowerPoint → Markdown, preserving slide boundaries.
 *
 * The firecrawl/anydoc extractor reads .pptx text correctly but flattens the deck into one
 * continuous run, so a 34-slide presentation arrives with no indication of where
 * one slide ends and the next begins. This reads the slide parts directly and
 * emits a heading per slide, keeping speaker notes attached to their slide.
 */

const path = require('path').posix;
const AdmZip = require('adm-zip');
const { rtlRatio } = require('./rtl');

// Section labels follow the deck's own language, so an English deck does not come
// back with Hebrew headings. Anything not detected as Hebrew falls back to English.
const LABELS = {
  en: {
    slide: n => `Slide ${n}`, notes: 'Speaker notes', empty: '_(no text on this slide)_',
    ocr: 'OCR text — unverified',
  },
  he: {
    slide: n => `שקופית ${n}`, notes: 'הערות דובר', empty: '_(שקופית ללא טקסט)_',
    ocr: 'טקסט OCR — לא מאומת',
  },
};

const XML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};

function unescapeXml(str) {
  return str
    .replace(/&(?:amp|lt|gt|quot|apos);/g, m => XML_ENTITIES[m])
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

// Slide numbers, footers, dates and the notes-page thumbnail are page furniture
// carried down from the master. They render as text runs like any other shape, so
// drop those shapes before reading paragraphs — a slide-number placeholder would
// otherwise surface as a stray digit in the slide body or the speaker notes.
function stripFurniture(xml) {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, shape =>
    /<p:ph[^>]*type="(?:sldNum|ftr|dt|sldImg)"/.test(shape) ? '' : shape
  );
}

// Text lives in <a:t> runs; <a:p> marks the paragraph they belong to.
function xmlToParagraphs(rawXml) {
  const xml = stripFurniture(rawXml);
  return xml
    .split('</a:p>')
    .map(block => {
      const runs = block.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) || [];
      return runs
        .map(run => unescapeXml(run.replace(/<a:t(?:\s[^>]*)?>/, '').replace(/<\/a:t>$/, '')))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    })
    .filter(Boolean);
}

function slideNumber(entryName) {
  return Number(entryName.match(/(\d+)\.xml$/)[1]);
}

const NOTES_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

// ppt/slides/slideN.xml -> ppt/slides/_rels/slideN.xml.rels
const relsPathFor = entryName => entryName.replace(/^(.*\/)([^/]+)$/, '$1_rels/$2.rels');

// Targets are relative to the directory the referencing part sits in — "../notesSlides/
// notesSlide1.xml" resolves against ppt/slides/, not the package root — except when a
// producer writes an absolute one, which starts with "/" and is package-rooted already.
const resolveRelTarget = (fromEntryName, target) => target.startsWith('/')
  ? target.slice(1)
  : path.normalize(path.join(path.dirname(fromEntryName), target));

/**
 * Every relationship a part declares about itself, read from its own .rels file — the
 * one primitive both a slide's notes and a slide's pictures are found through. A part's
 * own filename says nothing about what it's linked to; that link is always this file.
 */
function parseRelationships(relsXml) {
  return (relsXml.match(/<Relationship\b[^>]*\/>/g) || []).map(el => ({
    id: (el.match(/\bId="([^"]*)"/) || [])[1],
    type: (el.match(/\bType="([^"]*)"/) || [])[1],
    target: (el.match(/\bTarget="([^"]*)"/) || [])[1],
  }));
}

// PowerPoint numbers slide, notesSlide and media parts independently, so slide 1
// pointing at notesSlide2.xml is valid OOXML, and a deck that has been reordered or had
// a slide deleted is exactly when a filename-based guess and the real link drift apart.
// Reading a number back out of a filename would then attach the wrong notes to a slide,
// or silently drop real notes because nothing by that number exists — either way, wrong
// and invisible, since a generated fixture that only ever writes the two 1:1 can't catch
// it. This resolves the relationship a slide actually declares instead of guessing.
function notesEntryFor(slideEntryName, byName, readXml) {
  const relsPart = byName(relsPathFor(slideEntryName));
  if (!relsPart) return null;

  const rel = parseRelationships(readXml(relsPart)).find(r => r.type === NOTES_REL_TYPE);
  if (!rel || !rel.target) return null;

  return byName(resolveRelTarget(slideEntryName, rel.target));
}

// A slide with a genuine picture on it — not a background fill or a layout's own
// decoration, both of which reference an image the same way but are not content a
// reader placed on the slide. <p:pic> is specifically an inserted picture shape.
function slideHasPicture(xml) {
  return /<p:pic[\s>]/.test(xml);
}

// The r:embed reference on each <p:pic> shape, in document order — the relationship id
// a slide's own .rels file resolves to an actual media part.
function pictureRelIds(xml) {
  const shapes = xml.match(/<p:pic\b[\s\S]*?<\/p:pic>/g) || [];
  return shapes
    .map(shape => (shape.match(/r:embed="([^"]*)"/) || [])[1])
    .filter(Boolean);
}

/**
 * The raw bytes of every picture placed on one slide, in the order they appear.
 *
 * Cross-checked both ways: the relationship has to be of the image type, and its id has
 * to be one a <p:pic> shape on this slide actually references — a slide layout can carry
 * image relationships of its own that have nothing to do with what is drawn here.
 */
function slideImages(slideEntryName, slideXml, byName, readXml, readBinary) {
  const wanted = new Set(pictureRelIds(slideXml));
  if (!wanted.size) return [];

  const relsPart = byName(relsPathFor(slideEntryName));
  if (!relsPart) return [];

  const images = [];
  for (const rel of parseRelationships(readXml(relsPart))) {
    if (rel.type !== IMAGE_REL_TYPE || !rel.id || !wanted.has(rel.id)) continue;
    const entry = byName(resolveRelTarget(slideEntryName, rel.target));
    if (entry) images.push({ entryName: entry.entryName, data: readBinary(entry) });
  }
  return images;
}

/**
 * @param {string} filePath - Path to a .pptx
 * @param {object} [opts]
 * @param {boolean} [opts.notes=true] - Include speaker notes under each slide
 * @param {Map<number,string>} [opts.ocrSlides] - OCR transcript per slide number, for
 *   slides anydoc-ocr identified as holding a picture and no real text. Never overrides
 *   a slide that has real paragraphs — only fills in for one that has none, the same
 *   condition that would otherwise print `labels.empty`.
 * @returns {Promise<string>} Markdown
 */
async function pptxToMarkdown(filePath, opts = {}) {
  const includeNotes = opts.notes !== false;
  const ocrSlides = opts.ocrSlides || null;
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();

  const byName = name => entries.find(e => e.entryName === name);
  const readXml = entry => zip.readAsText(entry);

  const slides = entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));

  // Labels depend on the deck's language, so read every slide before emitting any.
  const parsed = slides.map(slide => ({
    n: slideNumber(slide.entryName),
    entryName: slide.entryName,
    paragraphs: xmlToParagraphs(zip.readAsText(slide)),
  }));

  const allText = parsed.flatMap(p => p.paragraphs).join(' ');
  const labels = rtlRatio(allText) > 0.3 ? LABELS.he : LABELS.en;

  const sections = [];

  for (const { n, entryName, paragraphs } of parsed) {
    const section = [`## ${labels.slide(n)}`];
    const ocrText = paragraphs.length ? null : ocrSlides && ocrSlides.get(n);

    if (paragraphs.length) section.push(paragraphs.join('\n\n'));
    // Marked the same way notes are: a machine-readable slide number in an HTML
    // comment, and labelled plainly as a guess rather than a reading, matching how
    // reconcile.js already frames OCR text recovered on the PDF path.
    else if (ocrText) section.push(`<!-- Slide ${n} OCR -->\n**${labels.ocr}:**\n\n${ocrText}`);
    else section.push(labels.empty);

    if (includeNotes) {
      const notesPart = notesEntryFor(entryName, byName, readXml);
      if (notesPart) {
        const notes = xmlToParagraphs(zip.readAsText(notesPart));
        // The marker carries the slide number in a machine-readable form: the
        // heading above already gives a reader the position, but notes lifted out
        // of the document on their own would lose it.
        if (notes.length) {
          section.push(`<!-- Slide ${n} notes -->\n> **${labels.notes}:** ${notes.join(' ')}`);
        }
      }
    }

    sections.push(section.join('\n\n'));
  }

  return sections.join('\n\n') + '\n';
}

/**
 * One entry per slide, read independently of pptxToMarkdown — the same separation
 * pdfLines() keeps from pdf-extract.js's own pdfToMarkdown, so a bug in rendering the
 * Markdown can never also corrupt the thing checking it. Shaped to match pdfLines()'s
 * own page objects, with one addition: `hasText` is `lines.length > 0` on a PDF page,
 * because a PDF page's lines are never anything but its own text — but a slide's lines
 * always carry this tool's own "## Slide N" heading too (see below), so `lines.length`
 * alone can no longer answer whether a slide holds anything beyond that label. `hasText`
 * is the answer reconcile.js actually needs: did this slide have real words, or an OCR
 * transcript standing in for them — not just its own structural heading.
 *
 * @param {string} filePath - Path to a .pptx
 * @param {Map<number,string>} [ocrSlides] - Recovered text for slides OCR was run on,
 *   the same map pptxToMarkdown splices into the Markdown — read here too so a second,
 *   independent verify() pass over an OCR'd deck sees the same recovered content pdf.js
 *   would see re-reading an OCR'd PDF's own rebuilt page, rather than reporting a slide
 *   as still empty forever because the source .pptx itself is never rewritten.
 * @returns {Promise<{number: number, lines: string[], picture: boolean, hasText: boolean}[]>}
 */
async function pptxSlideSummaries(filePath, ocrSlides = null) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const slides = entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));

  const parsed = slides.map(slide => {
    const xml = zip.readAsText(slide);
    return { number: slideNumber(slide.entryName), paragraphs: xmlToParagraphs(xml), hasPicture: slideHasPicture(xml) };
  });

  // pptxToMarkdown's own "## Slide N" heading is content a reader genuinely sees in the
  // output, but it is this tool's own label, not the deck's — read alone, a slide's
  // lines would hold none of it, and every deck's own numbering would then read as a
  // number the output added that the source never had. Carrying the same label here,
  // in the same language, keeps the two sides of that comparison honest.
  const allText = parsed.flatMap(p => p.paragraphs).join(' ');
  const labels = rtlRatio(allText) > 0.3 ? LABELS.he : LABELS.en;

  return parsed.map(s => {
    const ocrText = !s.paragraphs.length && ocrSlides && ocrSlides.get(s.number);
    const content = s.paragraphs.length ? s.paragraphs : ocrText ? [ocrText] : [];
    return {
      number: s.number,
      lines: [labels.slide(s.number), ...content],
      picture: !content.length && s.hasPicture,
      hasText: content.length > 0,
    };
  });
}

/**
 * The raw image bytes for a chosen set of slides — never all of them, since a deck can
 * run to hundreds of pictures a caller has no interest in reading.
 *
 * @param {string} filePath - Path to a .pptx
 * @param {number[]} slideNumbers
 * @returns {Promise<Map<number, {entryName: string, data: Buffer}[]>>}
 */
async function pptxSlideImages(filePath, slideNumbers) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const byName = name => entries.find(e => e.entryName === name);
  const readXml = entry => zip.readAsText(entry);
  const readBinary = entry => zip.readFile(entry);
  const wanted = new Set(slideNumbers);

  const slides = entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName) && wanted.has(slideNumber(e.entryName)));

  const result = new Map();
  for (const slide of slides) {
    const xml = zip.readAsText(slide);
    result.set(slideNumber(slide.entryName),
      slideImages(slide.entryName, xml, byName, readXml, readBinary));
  }
  return result;
}

module.exports = {
  pptxToMarkdown, pptxSlideSummaries, pptxSlideImages,
  _internals: {
    xmlToParagraphs, stripFurniture, LABELS, notesEntryFor,
    parseRelationships, slideHasPicture, pictureRelIds, slideImages,
  },
};
