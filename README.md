# markdownlint-rule-sembr

Four [markdownlint](https://github.com/DavidAnson/markdownlint) rules in support
of [semantic line breaks](https://sembr.org): breaking a line at a boundary of
meaning rather than at a fixed column.

Where that boundary falls is a question of meaning, and no rule answers it.
These check what a machine can decide around the break.

| Rule | Name | What it reports | Fixable |
| --- | --- | --- | --- |
| `SEMBR001` | `sembr-orphan-punctuation` | A line opening on `: ; ! ? » , )` — the break came one character too early | |
| `SEMBR002` | `sembr-non-breaking-space` | An ordinary space before `; : ! ? % »`, or after `«`. A break may happen there, and French typography forbids it | ✓ |
| `SEMBR003` | `sembr-one-sentence-per-line` | A sentence ending mid-line | ✓ |
| `SEMBR004` | `sembr-split-inline-span` | A code span split across two lines: it survives rendering, not a search | |

`SEMBR002` serves both languages from one rule: an ordinary space before that
punctuation is a typographic error in French, and does not occur in English.

## Install

```sh
npm install --save-dev markdownlint-rule-sembr
```

`markdownlint` itself is a peer dependency (`>= 0.37`), which
[markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2) already
brings.

## Use

In `.markdownlint-cli2.jsonc`:

```jsonc
{
  "customRules": ["markdownlint-rule-sembr"],
  "config": {
    "SEMBR001": true,
    "SEMBR002": true,
    "SEMBR004": true,
    // One sentence per line is a target more often than a starting point.
    // Enable it once the reflow is done, or run it on its own.
    "SEMBR003": { "abbreviations": ["p.", "ex.", "cf.", "réf."] }
  }
}
```

`markdownlint-cli2 --fix` applies what `SEMBR002` and `SEMBR003` propose:
non-breaking spaces in place, and a line break after a sentence that repeats
whatever prefix keeps it in its block — a blockquote marker, the indentation of
a list item.

### Options

`SEMBR003` takes `abbreviations`: full stops that do not end a sentence, added
to the list [sentence-splitter](https://github.com/textlint-rule/sentence-splitter)
already knows. Its list is English, so a French document wants at least
`p.`, `ex.` and `cf.`. The other three rules take no options.

## What the rules do not read

They run on the micromark token stream, so fenced and indented code blocks, HTML
blocks and tables are skipped whole, and code spans, link destinations,
autolinks and images are masked inside a line before any rule sees it. Link
*text* stays visible: it is prose, and a sentence can end in it.

## Licence

[EUPL-1.2](LICENSE).
