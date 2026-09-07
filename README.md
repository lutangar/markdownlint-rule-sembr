# markdownlint-sembr

Four [markdownlint](https://github.com/DavidAnson/markdownlint) rules in support
of **semantic line breaks** — breaking a line at a boundary of meaning rather
than at a fixed column ([sembr.org](https://sembr.org)).

No tool can decide where that boundary is. These check the things around it that
a machine can decide.

| Rule | Name | What it catches |
| --- | --- | --- |
| `SEMBR001` | `sembr-orphan-punctuation` | A line opening on `: ; ! ? » , )` — the break came one character too early |
| `SEMBR002` | `sembr-non-breaking-space` | An ordinary space before `; : ! ? % »` or after `«`. Wrong in French (it may break there) and impossible in English, so one rule serves both. **Fixable** with `--fix` |
| `SEMBR003` | `sembr-one-sentence-per-line` | A sentence ending mid-line. Off by default in this repository — the target, not yet the state |
| `SEMBR004` | `sembr-split-inline-span` | A code span split across two lines, which survives rendering but not a `grep` |

## Use

```jsonc
{
  "customRules": ["./packages/markdownlint-sembr/index.mjs"],
  "config": { "SEMBR001": true, "SEMBR002": true, "SEMBR004": true }
}
```

Plain `.mjs`: markdownlint loads the module directly, so a rule needing a build
step would make linting depend on compiling.

## Known limits

- `parser: "none"` — these are line-level checks, so fenced blocks and table
  rows are skipped by hand, and inline spans, link destinations and autolinks
  are masked before a rule sees them. An indented code block inside a list may
  still reach a rule.
- `SEMBR003` skips single letters (`e.g.`), digits (`0.2.0`) and a short
  abbreviation list before the full stop. Extend `ABBREVIATIONS` in
  `index.mjs` rather than adding an exception at the call site.

## Licence

[EUPL-1.2](../../LICENSE).
