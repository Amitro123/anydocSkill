/**
 * Argument parsing and the ocrmypdf invocation itself, kept out of src/ocr.js the same
 * way src/convert-args.js is kept out of src/convert.js: so requiring this to unit-test
 * it does not run the CLI, and does not need ocrmypdf installed to check what command
 * line this would have handed it.
 */

const FLAGS = ['--out-dir', '--lang', '--format'];

function parseArgs(argv) {
  const args = { input: null, outDir: null, lang: 'heb+eng', format: 'both' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      if (!FLAGS.includes(arg)) {
        throw new Error(`Unknown option "${arg}". Options are: ${FLAGS.join(', ')}.`);
      }
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) {
        throw new Error(`${arg} needs a value.`);
      }
      if (arg === '--out-dir') args.outDir = argv[++i];
      else if (arg === '--lang') args.lang = argv[++i];
      else if (arg === '--format') args.format = argv[++i];
      continue;
    }
    if (args.input) throw new Error(`Only one input file at a time; got "${args.input}" and "${arg}".`);
    args.input = arg;
  }
  if (!['md', 'html', 'both'].includes(args.format)) {
    throw new Error(`Unknown --format "${args.format}". Use md, html, or both.`);
  }
  return args;
}

/**
 * One page, one ocrmypdf invocation.
 *
 * ocrmypdf's --sidecar writes a single transcript file for the whole document it is
 * given, one chunk per page, and a page it was told to leave alone becomes a bracketed
 * placeholder rather than disappearing — chunks that span a *range* of skipped pages
 * when several are consecutive. That makes chunk position depend on how many pages
 * around the one wanted were also skipped, which is fragile to parse back out. Running
 * one page at a time sidesteps it entirely: the sidecar for that run holds exactly one
 * real chunk, unambiguously, so parseSidecar() below never has to reconstruct a page
 * number from position.
 *
 * --pages restricts the run to that one page; --skip-text is a second, independent
 * guard saying the same thing in ocrmypdf's own terms, for the case where its idea of
 * "has text" ever disagrees with anydoc's.
 *
 * The output PDF this produces is never read — see src/ocr-pdf.js for why: its own
 * embedded OCR text layer is exactly the thing found to come back character-reversed on
 * real Hebrew scans, in a way the plain-text --sidecar transcript alongside it does not.
 * It still has to be written, since ocrmypdf takes an output path as a required argument.
 */
function buildSidecarOcrArgs(inputPath, outputPath, sidecarPath, page, lang) {
  return [
    '-l', lang,
    '--pages', String(page),
    '--skip-text',
    '--output-type', 'pdf',
    '--optimize', '0',
    '--sidecar', sidecarPath,
    inputPath, outputPath,
  ];
}

/**
 * One picture, one ocrmypdf invocation.
 *
 * ocrmypdf accepts a raster image directly and converts it to a one-page PDF as its
 * first internal step, so --pages and --skip-text — both about restricting a run to
 * part of a multi-page document that might already have text — have nothing to mean
 * here: there is only ever the one page, and an image extracted from a slide has no
 * pre-existing text layer to skip in the first place.
 */
function buildSidecarImageOcrArgs(inputPath, outputPath, sidecarPath, lang) {
  return [
    '-l', lang,
    '--output-type', 'pdf',
    '--optimize', '0',
    '--sidecar', sidecarPath,
    inputPath, outputPath,
  ];
}

// A whole chunk naming a page or range ocrmypdf was told to leave alone — never a
// document's own text, which makes it safe to filter out unconditionally rather than
// trying to tell it apart from a real transcript that happens to start similarly.
const SKIPPED_CHUNK = /^\[OCR skipped on page\(s\) [\d,\s-]+\]$/;

/**
 * The real transcript out of a --sidecar file, with ocrmypdf's own skip placeholders
 * removed.
 *
 * Split on the form feed ocrmypdf uses as a page separator — not on blank lines, which
 * a real multi-paragraph transcript has plenty of. What is left after the skip chunks
 * are dropped is empty when OCR was run but found nothing, which is a real, reportable
 * outcome rather than an error this needs to treat specially: an empty transcript
 * reads as an empty page everywhere downstream, exactly as a page with no text should.
 */
function parseSidecar(text) {
  const chunks = text.split('\f').map(c => c.trim()).filter(Boolean);
  return chunks.filter(c => !SKIPPED_CHUNK.test(c)).join('\n\n');
}

module.exports = {
  parseArgs, buildSidecarOcrArgs, buildSidecarImageOcrArgs, parseSidecar,
  _internals: { FLAGS, SKIPPED_CHUNK },
};
