# anydoc Skill — RTL Support

Claude Code skill that wraps [anydoc](https://github.com/firecrawl/anydoc) with automatic RTL (Hebrew/Arabic) detection and Markdown output formatting.

## What it does

- Converts documents (PDF, Word, PowerPoint, Excel, EPUB, CSV, RTF) to Markdown via anydoc
- Detects RTL languages by counting Hebrew/Arabic Unicode characters
- Injects `dir: rtl` / `lang: he` YAML front-matter
- Renders a standalone, print-ready HTML document with correct RTL layout

## Files

```
src/rtl.js           — RTL detection, visual-order guard, Markdown post-processing
src/pdf-extract.js   — PDF geometry fallback + shared item joining
src/pdf-structure.js — Tagged-PDF structure tree reader
src/pptx-extract.js  — PowerPoint → Markdown, one section per slide
src/render-html.js   — Markdown → standalone RTL-aware HTML document
src/convert.js       — CLI: routing, RTL, output formats
src/rtl.test.js      — Unit tests

.claude/skills/anydoc/SKILL.md — Claude Code skill definition
```

## Quick start

```bash
npm install                     # marked + @firecrawl/anydoc

node src/convert.js contract.pdf --format both
node src/convert.js contract.pdf --format html --out-dir ./out
```

`--format` accepts `md`, `html`, or `both` (default). Markdown input skips anydoc
entirely, so an existing `.md` can be rendered to HTML without it installed.

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
Slide-number, footer and date placeholders inherited from the master are dropped.

## RTL detection threshold

A document is treated as RTL when > 30% of its letter characters fall in the Hebrew
(`U+0590–05FF`) or Arabic (`U+0600–06FF`) Unicode blocks. Adjust `RTL_THRESHOLD` in
`src/rtl.js` if needed.

## Tests

```bash
npm test
```
