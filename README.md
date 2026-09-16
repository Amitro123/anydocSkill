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

## RTL detection threshold

A document is treated as RTL when > 30% of its letter characters fall in the Hebrew
(`U+0590–05FF`) or Arabic (`U+0600–06FF`) Unicode blocks. Adjust `RTL_THRESHOLD` in
`src/rtl.js` if needed.

## Tests

```bash
npm test
```
