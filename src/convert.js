#!/usr/bin/env node
/**
 * CLI wrapper: convert a document to RTL-aware Markdown using anydoc.
 *
 * Usage:
 *   node convert.js <input-file> [output-file]
 *
 * If anydoc is not installed the script prints install instructions and exits.
 */

const path = require('path');
const fs = require('fs');
const { addRtlSupport } = require('./rtl');

async function convert(inputPath, outputPath) {
  let anydoc;
  try {
    anydoc = require('anydoc');
  } catch {
    console.error(
      'anydoc is not installed. Run:\n\n  npm install anydoc\n\nor:\n\n  pip install anydoc\n'
    );
    process.exit(1);
  }

  const buf = fs.readFileSync(inputPath);
  const title = path.basename(inputPath, path.extname(inputPath));

  // anydoc returns { markdown, metadata }
  const { markdown } = await anydoc.convert(buf, { filename: path.basename(inputPath) });

  const result = addRtlSupport(markdown, title);

  if (outputPath) {
    fs.writeFileSync(outputPath, result, 'utf8');
    console.log(`Written to ${outputPath}`);
  } else {
    process.stdout.write(result);
  }
}

const [, , input, output] = process.argv;
if (!input) {
  console.error('Usage: node convert.js <input-file> [output-file]');
  process.exit(1);
}
convert(input, output).catch(err => { console.error(err); process.exit(1); });
