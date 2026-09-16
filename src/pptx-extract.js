/**
 * PowerPoint → Markdown, preserving slide boundaries.
 *
 * anydoc extracts .pptx text correctly but flattens the whole deck into one
 * continuous run, so a 34-slide presentation arrives with no indication of where
 * one slide ends and the next begins. This reads the slide parts directly and
 * emits a heading per slide, keeping speaker notes attached to their slide.
 */

const AdmZip = require('adm-zip');

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

  const slides = entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));

  const sections = [];

  for (const slide of slides) {
    const n = slideNumber(slide.entryName);
    const paragraphs = xmlToParagraphs(zip.readAsText(slide));

    const section = [`## שקופית ${n}`];
    if (paragraphs.length) section.push(paragraphs.join('\n\n'));
    else section.push('_(שקופית ללא טקסט)_');

    if (includeNotes) {
      const notesPart = byName(`ppt/notesSlides/notesSlide${n}.xml`);
      if (notesPart) {
        const notes = xmlToParagraphs(zip.readAsText(notesPart));
        if (notes.length) section.push(`> **הערות דובר:** ${notes.join(' ')}`);
      }
    }

    sections.push(section.join('\n\n'));
  }

  return sections.join('\n\n') + '\n';
}

module.exports = { pptxToMarkdown, _internals: { xmlToParagraphs, stripFurniture } };
