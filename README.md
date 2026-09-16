# anydoc Skill — RTL Support

Claude Code skill that wraps [anydoc](https://github.com/firecrawl/anydoc) with automatic RTL (Hebrew/Arabic) detection and Markdown output formatting.

## What it does

- Converts documents (PDF, Word, PowerPoint, Excel, EPUB, CSV, RTF) to Markdown via anydoc
- Detects RTL languages by counting Hebrew/Arabic Unicode characters
- Injects `dir: rtl` / `lang: he` YAML front-matter
- Wraps document body in `<div dir="rtl">` for renderer compatibility

## Files

```
src/rtl.js        — RTL detection and Markdown post-processing
src/convert.js    — CLI wrapper around anydoc + rtl.js
src/rtl.test.js   — Unit tests

.claude/skills/anydoc/SKILL.md — Claude Code skill definition
```

## Quick start

```bash
npm install anydoc          # peer dependency
node src/convert.js input.pdf output.md
```

## Usage as a Claude Code skill

```
/anydoc ./contract.pdf
```

## RTL detection threshold

A paragraph is treated as RTL when > 30% of its letter characters fall in the Hebrew (`U+0590–05FF`) or Arabic (`U+0600–06FF`) Unicode blocks. Adjust `RTL_THRESHOLD` in `src/rtl.js` if needed.

## Tests

```bash
npm test
```
