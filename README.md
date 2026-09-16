# anydoc Skill — RTL Support

Claude Code skill that wraps [anydoc](https://github.com/firecrawl/anydoc) with automatic RTL (Hebrew/Arabic) detection and Markdown output formatting.

## What it does

- Converts documents (PDF, Word, PowerPoint, Excel, EPUB, CSV, RTF) to Markdown via anydoc
- Detects RTL languages by counting Hebrew/Arabic Unicode characters
- Injects `dir: rtl` / `lang: he` YAML front-matter
- Renders a standalone, print-ready HTML document with correct RTL layout

## Files

```
src/rtl.js          — RTL detection and Markdown post-processing
src/render-html.js  — Markdown → standalone RTL-aware HTML document
src/convert.js      — CLI: anydoc + RTL + output formats
src/rtl.test.js     — Unit tests

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

## PDFs go through pdf.js, not anydoc

anydoc's PDF path extracts Hebrew in visual order, so every word arrives
character-reversed (`רושיג` instead of `גישור`) — unreadable and unsearchable, and
unrecoverable downstream since the text is scrambled before any RTL handling runs.

`src/pdf-extract.js` handles PDFs with pdf.js instead, which returns text items in
logical reading order. It reconstructs lines from `hasEOL` and groups them into
paragraphs by line gap and line width, drops headers and footers that repeat on every
page, and leaves source numbering as literal text so clause numbers in legal documents
are never renumbered.

`convert.js` still runs a visual-order check on every extraction, whichever path
produced it, and refuses to write scrambled output. Detection counts Hebrew final-form
letters (ך ם ן ף ץ): they appear only word-finally in correct Hebrew and only
word-initially in reversed text. On a real 21-clause agreement, anydoc scored
241 leading / 0 trailing; pdf.js scores 0 / 241 on the same file.

Pass `--force` to write output that fails the check.

## RTL detection threshold

A document is treated as RTL when > 30% of its letter characters fall in the Hebrew
(`U+0590–05FF`) or Arabic (`U+0600–06FF`) Unicode blocks. Adjust `RTL_THRESHOLD` in
`src/rtl.js` if needed.

## Tests

```bash
npm test
```
