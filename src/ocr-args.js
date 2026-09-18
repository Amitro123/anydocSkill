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

// A plain comma list. ocrmypdf's --pages also accepts ranges ("3-9"), but the pages
// this ever calls it with come from a --report's pictureOnly array — usually few and
// rarely contiguous — so collapsing them into ranges would add code with nothing to
// show for it. A list is exactly as valid an argument as a range is.
function pageListArg(pages) {
  return pages.join(',');
}

/**
 * The ocrmypdf invocation, kept pure so the argument list — the part most likely to
 * need a flag added or changed later — is something a unit test can check without
 * ocrmypdf installed to run it against.
 *
 * --pages restricts the run to exactly the pages this decided are unreadable; --skip-text
 * is a second, independent guard saying the same thing in ocrmypdf's own terms, for the
 * case where its idea of "has text" ever disagrees with anydoc's. Between the two, every
 * other page is supposed to leave this untouched — and src/reconcile.js is what actually
 * checks that it did, rather than trusting the flags alone to have worked.
 */
function buildOcrArgs(inputPath, outputPath, pages, lang) {
  return [
    '-l', lang,
    '--pages', pageListArg(pages),
    '--skip-text',
    '--output-type', 'pdf',
    // Recompressing images is ocrmypdf's default and is no part of this tool's job — it
    // exists to add missing text, not to shrink a file that converts fine everywhere else.
    '--optimize', '0',
    inputPath, outputPath,
  ];
}

module.exports = { parseArgs, pageListArg, buildOcrArgs, _internals: { FLAGS } };
