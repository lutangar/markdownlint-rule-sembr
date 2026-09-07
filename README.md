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

## Reflowing a document

A lint rule can only edit the line it reports on, so `--fix` breaks after a
sentence and leaves the rest of the old wrapping where it was — one sentence per
line, and a staircase of short lines after it. Reflowing means unwrapping the
block first, which is a formatter's job.

```sh
npx sembr-format doc/*.md
```

It joins each prose block, splits it into sentences, and wraps each one at the
latest boundary of meaning that fits — a clause end within reach, plain filling
otherwise. `SEMBR_WIDTH` sets the target (88 by default). Headings, tables, code
blocks and link definitions are copied through untouched.

**It renders both versions and compares them before writing anything**, and
refuses the file if they differ. That is not ceremony: writing it turned up a
blockquote continuation losing its marker, a break that left `**` preceded by a
space (which stops being emphasis), a bare `>` line silently merging two
paragraphs, and a sentence split inside `` `overdueMinors !== 0` `` — the
splitter does not know Markdown, so the atoms are masked before it runs.

### Options

`SEMBR003` takes `abbreviations`: full stops that do not end a sentence, added
to the list [sentence-splitter](https://github.com/textlint-rule/sentence-splitter)
already knows. Its list is English, so a French document wants at least
`p.`, `ex.` and `cf.`. The other three rules take no options.

## Against the specification

[SemBr 1.0](https://sembr.org) states thirteen rules. What this package covers,
and what it does not:

| Spec | | Here |
| --- | --- | --- |
| 4 | A break **MUST** occur after a sentence | `SEMBR003` — the only MUST about placement, and the one rule that can be fixed automatically |
| 2 | A break **MUST NOT** alter the rendered output | Property-tested: the fixes are applied to a corpus and both renderings compared, whitespace collapsed as HTML collapses it |
| 9 | A break **MUST NOT** occur within a hyphenated word | By construction — the fixer only ever breaks after sentence-final punctuation |
| 12, 13 | 80 characters **RECOMMENDED**, longer lines allowed for links and code | Not this package's business: `MD013` with `strict: false` already says exactly that |
| 5 | A break **SHOULD** occur after an independent clause (`,` `;` `:` `—`) | **Not implemented.** Deciding whether a comma separates independent clauses is the part no rule answers |
| 1, 3, 6, 7, 8, 10, 11 | MAY and SHOULD, on grouping and emphasis | Editorial: not machine-checkable |

`SEMBR001`, `SEMBR002` and `SEMBR004` are outside the specification. It says
where a break should fall; they say what a break must not damage on its way.

## What the rules do not read

They run on the micromark token stream, so fenced and indented code blocks, HTML
blocks and tables are skipped whole, and code spans, link destinations,
autolinks and images are masked inside a line before any rule sees it. Link
*text* stays visible: it is prose, and a sentence can end in it.

## Licence

[MIT](LICENSE).
