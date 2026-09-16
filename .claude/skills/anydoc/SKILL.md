# anydoc Skill

Convert documents (PDF, Word, PowerPoint, Excel, EPUB, CSV, RTF, OpenDocument) to clean Markdown using the [anydoc](https://github.com/firecrawl/anydoc) library.

## Usage

```
/anydoc <file-path-or-url>
```

## What it does

1. Reads the document at the given path or URL
2. Converts it to GitHub-Flavored Markdown via anydoc
3. Detects RTL languages (Hebrew, Arabic, Persian, Urdu) and adds proper RTL wrappers
4. Outputs the result to `<filename>.md` in the same directory

## RTL Support

When the document contains RTL text (Hebrew, Arabic, etc.), the output Markdown includes:
- `<!-- rtl -->` front-matter flag
- HTML `<div dir="rtl" lang="he">` wrappers around RTL paragraphs
- Document-level `dir: rtl` in YAML front-matter

Detection heuristic: if more than 30% of characters in a paragraph fall in the Hebrew (`֐–׿`) or Arabic (`؀–ۿ`) Unicode blocks, the paragraph is treated as RTL.

## Output format

```markdown
---
title: Document Title
dir: rtl
lang: he
---

<div dir="rtl">

...converted content...

</div>
```

## Implementation notes

- Uses `anydoc` npm package (or Python `anydoc` library) for the conversion engine
- RTL detection runs as a post-processing pass on the raw Markdown output
- Falls back to plain Markdown if anydoc is not installed (prints install instructions)
