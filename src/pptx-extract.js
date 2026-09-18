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
  en: { slide: n => `Slide ${n}`, notes: 'Speaker notes', empty: '_(no text on this slide)_' },
  he: { slide: n => `שקופית ${n}`, notes: 'הערות דובר', empty: '_(שקופית ללא טקסט)_' },
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

// A part's own filename says nothing about which notes belong to it — that link is a
// relationship, not a naming convention. PowerPoint numbers slide and notesSlide parts
// independently, so slide 1 pointing at notesSlide2.xml is valid OOXML, and a deck that
// has been reordered or had a slide deleted is exactly when the two drift apart. Reading
// the number back out of the filename would then attach the wrong notes to a slide, or
// silently drop real notes because nothing by that number exists — either way, wrong and
// invisible, since a generated fixture that only ever writes the two 1:1 can't catch it.
function notesEntryFor(slideEntryName, byName, readXml) {
  // ppt/slides/slideN.xml -> ppt/slides/_rels/slideN.xml.rels
  const relsName = slideEntryName.replace(/^(.*\/)([^/]+)$/, '$1_rels/$2.rels');
  const relsPart = byName(relsName);
  if (!relsPart) return null;

  const relationships = readXml(relsPart).match(/<Relationship\b[^>]*\/>/g) || [];
  const notesRel = relationships.find(
    rel => (rel.match(/\bType="([^"]*)"/) || [])[1] === NOTES_REL_TYPE);
  const target = notesRel && (notesRel.match(/\bTarget="([^"]*)"/) || [])[1];
  if (!target) return null;

  // Targets are relative to the directory the referencing part sits in — "../notesSlides/
  // notesSlide1.xml" resolves against ppt/slides/, not the package root — except when a
  // producer writes an absolute one, which starts with "/" and is package-rooted already.
  const resolved = target.startsWith('/')
    ? target.slice(1)
    : path.normalize(path.join(path.dirname(slideEntryName), target));

  return byName(resolved);
}

/**
 * @param {string} filePath - Path to a .pptx
 * @param {object} [opts]
 * @param {boolean} [opts.notes=true] - Include speaker notes under each slide
 * @returns {Promise<string>} Markdown
 */
async function pptxToMarkdown(filePath, opts = {}) {
  const includeNotes = opts.notes !== false;
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
    section.push(paragraphs.length ? paragraphs.join('\n\n') : labels.empty);

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

module.exports = {
  pptxToMarkdown, _internals: { xmlToParagraphs, stripFurniture, LABELS, notesEntryFor },
};
