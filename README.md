# anydoc Skill — RTL Support

Claude Code skill that wraps [anydoc](https://github.com/firecrawl/anydoc) with automatic RTL (Hebrew/Arabic) detection and Markdown output formatting.

## What it does

- Converts PDF, Word, PowerPoint, Excel, OpenDocument, EPUB, RTF and CSV to Markdown
- Detects RTL languages and refuses to emit text an extractor returned scrambled
- Injects `dir: rtl` / `lang: he` YAML front-matter
- Renders a standalone, print-ready HTML document with correct RTL layout

PDF and PowerPoint use their own readers rather than anydoc — see below for why.

## Files

```
src/rtl.js           — RTL detection, visual-order guard, Markdown post-processing
src/pdf-extract.js   — PDF geometry fallback + shared item joining
src/pdf-structure.js — Tagged-PDF structure tree reader
src/pptx-extract.js  — PowerPoint → Markdown, one section per slide
src/render-html.js   — Markdown → standalone RTL-aware HTML document
src/convert.js       — CLI: routing, RTL, output formats
src/rtl.test.js      — Unit tests (pure helpers)
test/fixtures.js     — Generates the documents the integration tests convert
test/integration.test.js — End-to-end conversions

.claude/skills/anydoc/SKILL.md — Claude Code skill definition
.github/workflows/ci.yml       — Runs both suites on Node 22.13 and 24
```

## Quick start

```bash
npm install                     # anydoc, pdf.js, marked, adm-zip

node src/convert.js contract.pdf --format both
node src/convert.js contract.pdf --format html --out-dir ./out
```

`--format` accepts `md`, `html`, or `both` (default). Text input (`.md`, `.txt`) skips
extraction entirely, so an existing file can be rendered to HTML without anydoc.

## Usage as a Claude Code skill

```
/anydoc ./contract.pdf
```

The skill asks which output format you want before converting, unless your request
already names one.

## Why `dir` goes on `<html>`

The generated HTML sets `dir` and `lang` on the `<html>` element rather than relying on
CSS `direction: rtl`. `dir` is an inherited HTML attribute that gives the Unicode
bidirectional algorithm a base direction to resolve against, so mixed Hebrew/Latin runs —
names, ID numbers, phone numbers, currency — lay out correctly. CSS `direction` sets
visual direction without supplying that base, and mixed content comes out wrong.

## PDFs: structure tree first, geometry as fallback

anydoc's PDF path extracts Hebrew in visual order, so every word arrives
character-reversed (`רושיג` instead of `גישור`) — unrecoverable downstream, since the
text is scrambled before any RTL handling runs. PDFs go through pdf.js instead.

A tagged PDF (Word, LibreOffice and most modern exporters produce one) carries a
structure tree declaring its paragraphs, lists and tables. `src/pdf-structure.js` reads
it, which gives exact boundaries rather than inferred ones and skips headers and footers
for free, since artifacts are untagged. On a court form the tree resolved 31 blocks
where the geometry pass had merged four separate lines into one.

`src/pdf-extract.js` is the fallback for untagged PDFs, inferring paragraphs from line
gaps and line widths. It also supplies the shared item-joining used by both paths: PDFs
space words by positioning glyphs rather than emitting spaces, so word breaks are read
back from the gaps between items.

**Numbering is never rewritten.** Markdown renumbers ordered lists, so a list becomes one
only where the document's own labels are the sequence Markdown would render. Labels that
restart, skip, or use Hebrew letters split into separate runs or stay literal bullets.

**Embedded left-to-right runs are reordered.** In an RTL paragraph pdf.js emits items
right-to-left, which reverses a run that reads left-to-right internally: a case number
split across items arrived as `26-01-123456` instead of `123456-01-26`. Each such run is
sorted by ascending x, per line.

The ceiling is set by how the source was authored. Both test documents tag every block
as `P` because they were formatted by hand rather than with real heading styles, so no
headings appear however well the tree is read.

## PowerPoint keeps slide boundaries

anydoc flattens a deck into one continuous run. `src/pptx-extract.js` reads the slide
parts directly so each slide becomes its own section, with speaker notes attached.
Slide-number, footer and date placeholders inherited from the master are dropped, and
section labels follow the deck's own language rather than being hardcoded.

## Formats

| Format | Path | Notes |
|---|---|---|
| `.pdf` | pdf.js | Structure tree when tagged, geometry otherwise |
| `.pptx` | direct | One section per slide, notes attached |
| `.docx` `.doc` | anydoc | Best structural fidelity of any input |
| `.xlsx` `.xls` `.csv` | anydoc | Rendered as Markdown tables |
| `.odt` `.rtf` `.epub` | anydoc | Headings survive when the source used real styles |
| `.md` `.txt` | read directly | RTL post-processing only |

`.ppt` (legacy binary PowerPoint) goes through anydoc, so it converts but without
slide boundaries — the direct reader needs the modern zip container. Prefer `.pptx`.

Verified end to end on Hebrew samples in every row above. Arabic shares the same code
paths and is detected by the same Unicode ranges, but has not been tested on a real
document.

## RTL detection threshold

A document is treated as RTL when > 30% of its letter characters fall in the Hebrew
(`U+0590–05FF`) or Arabic (`U+0600–06FF`) Unicode blocks. Adjust `RTL_THRESHOLD` in
`src/rtl.js` if needed.

## Tests

```bash
npm test              # both suites
npm run test:unit     # pure helpers
npm run test:integration
```

The unit suite covers pure helpers. It would pass even with every converter broken —
each extraction bug found while building this was invisible to it — so the integration
suite generates small documents in each supported format, runs them through the CLI,
and asserts on the output. Fixtures are built at test time rather than committed, so
the suite carries no real documents and the Hebrew under test stays readable in
`test/fixtures.js`.

CI runs both on Node 22.13 and 24 for every push and pull request. Node 22.13 is the
floor because `pdfjs-dist` requires it.

## License

MIT — see [LICENSE](LICENSE).
