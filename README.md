# anydoc-skill

Claude Code skill that converts documents to Markdown and to a standalone HTML page,
with correct right-to-left layout for Hebrew.

## Install

```bash
npm install
```

Requires Node 22.13 or later.

## Use

```bash
node src/convert.js contract.pdf                      # writes contract.md + contract.html
node src/convert.js deck.pptx --format md
node src/convert.js report.docx --format html --out-dir ./out
```

`--format` is `md`, `html`, or `both` (default). Output lands next to the input unless
`--out-dir` is given. `--force` writes output that failed the scrambled-text check.

As a Claude Code skill, `/anydoc <file>` — it asks which format you want unless your
request already names one.

## Formats

| Input | Handled by | Notes |
|---|---|---|
| `.pdf` | pdf.js | Structure tree when tagged, page geometry otherwise |
| `.pptx` | direct | One section per slide, speaker notes included |
| `.docx` `.doc` | anydoc | Best structural fidelity of any input |
| `.xlsx` `.xls` `.csv` | anydoc | Markdown tables |
| `.odt` `.rtf` `.epub` | anydoc | Headings survive if the source used real styles |
| `.md` `.txt` | read directly | RTL post-processing only |

`.ppt` converts through anydoc but without slide boundaries; prefer `.pptx`.

Arabic uses the same code paths and is detected by the same Unicode ranges, but is
untested and the scrambled-text check does not cover it.

## Things not to undo

Four decisions look like they could be simplified. They cannot:

- **`dir` goes on `<html>`, not `direction: rtl` in CSS.** `dir` is inherited and gives
  the Unicode bidi algorithm a base direction. CSS alone sets visual direction without
  that base, and mixed Hebrew/Latin runs — IDs, phone numbers, currency — come out wrong.
- **PDFs do not go through anydoc.** Its PDF extractor returns Hebrew in visual order,
  every word character-reversed, which nothing downstream can repair.
- **List numbering is copied, never regenerated.** Markdown renumbers ordered lists, so
  one is only emitted where the document's own labels match what Markdown would render.
  Legal clause numbering must survive exactly.
- **Left-to-right runs inside RTL text are reordered by x.** pdf.js emits items
  right-to-left; a hyphenated case number split across items arrives backwards otherwise.

Every extraction is checked for visual-order scrambling before anything is written.

## Tests

```bash
npm test                    # both suites
npm run test:unit
npm run test:integration
```

The unit suite covers pure helpers; the integration suite generates a document in each
format, runs it through the CLI, and asserts on the output. Fixtures are built at test
time, so no documents are stored in this repo.

CI runs both on Node 22.13 and 24.

## License

MIT — see [LICENSE](LICENSE).
