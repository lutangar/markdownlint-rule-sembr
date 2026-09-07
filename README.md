# markdownlint-rule-sembr

Four [markdownlint](https://github.com/DavidAnson/markdownlint)
rules in support of [semantic line breaks](https://sembr.org):
breaking a line at a boundary of meaning rather than at a fixed column.

Where that boundary falls is a question of meaning, and no rule answers it.
These check what a machine can decide around the break.

| Rule | Alias | Fixable |
| --- | --- | --- |
| [`SEMBR001`](#sembr001---line-starts-with-punctuation-that-belongs-to-the-previous-line) | `sembr-orphan-punctuation` | |
| [`SEMBR002`](#sembr002---ordinary-space-where-french-typography-requires-a-non-breaking-one) | `sembr-non-breaking-space` | ✓ |
| [`SEMBR003`](#sembr003---a-sentence-ends-mid-line) | `sembr-one-sentence-per-line` | ✓ |
| [`SEMBR004`](#sembr004---a-code-span-is-split-across-lines) | `sembr-split-inline-span` | |

## Install

```sh
npm install --save-dev markdownlint-rule-sembr
```

Node 22 or later, which is what `markdownlint-rule-helpers` requires.

In `.markdownlint-cli2.jsonc`:

```jsonc
{
  "customRules": ["markdownlint-rule-sembr"],
  "config": {
    // One sentence per line is a target more often than a starting point: on an
    // existing repository it reports every wrapped paragraph at once. Turn it on
    // when the reflow is done, or run it on its own.
    "SEMBR003": false
  }
}
```

**The rules are opt-out, not opt-in.** Loading `customRules` enables all four,
as it does for any markdownlint rule: with `"default": true`,
or with no `config` at all, they are on.
Name the ones you do not want.

## Rules

### `SEMBR001` - Line starts with punctuation that belongs to the previous line

Tags: `whitespace`, `sembr`

Aliases: `sembr-orphan-punctuation`

A line opening on `:` `;` `!` `?` `»` `,` or `)` is a break made one character too
early.
The punctuation closes what the previous line said, and reading it alone at the start of
a line costs the reader a beat.

```markdown
<!-- Triggers -->
Une phrase coupée
: trop tôt.

<!-- Passes -->
Une phrase coupée :
au bon endroit.
```

### `SEMBR002` - Ordinary space where French typography requires a non-breaking one

Tags: `whitespace`, `sembr`

Aliases: `sembr-non-breaking-space`

Fixable: violations can be fixed by tooling

French puts a space before `;` `:` `!` `?` `%` and inside `«` `»`,
and that space must not break.
Written as an ordinary space, a renderer is free to end the line there and leave the
punctuation stranded at the start of the next one.

One rule serves both languages: an ordinary space in front of that punctuation is a
mistake in French and does not occur in English at all.

The fix inserts the right character — U+00A0 before `:` and inside the quotation marks,
U+202F (thin) before `;` `!` `?` `%`.

```markdown
<!-- Triggers -->
Deux règles : une ; et une autre !

<!-- Passes: the same line, with the spaces before the punctuation
     replaced by U+00A0 and U+202F -->
```

> [!NOTE]
> Those characters are invisible in a source file.
> Some teams would rather keep ordinary spaces in Markdown and apply French spacing when
> rendering; this rule is off in such a repository, which is what `"SEMBR002": false` is
> for.

### `SEMBR003` - A sentence ends mid-line

Tags: `sembr`

Aliases: `sembr-one-sentence-per-line`

Parameters:

- `abbreviations`: full stops that do not end a sentence (`string[]`, default `[]`)

Fixable: violations can be fixed by tooling

The one **MUST** of the specification about where a break falls.
Sentence boundaries come from
[sentence-splitter](https://github.com/textlint-rule/sentence-splitter),
which already knows about abbreviations, decimals and quotation marks;
its list is English, so a French document wants at least `p.`, `ex.` and `cf.`.

The fix repeats whatever prefix keeps the line in its block — a blockquote marker,
the indentation of a list item.

```markdown
<!-- Triggers -->
La première. La seconde.

<!-- Passes -->
La première.
La seconde.
```

Headings are left alone: a heading is one unit whatever punctuation it carries.

### `SEMBR004` - A code span is split across lines

Tags: `code`, `sembr`

Aliases: `sembr-split-inline-span`

A code span broken in two still renders, so nothing looks wrong —
but the identifier inside it can no longer be found by a search,
which is what people actually do with code in prose.

````markdown
<!-- Triggers -->
Call `myFunction(
argument)` here.

<!-- Passes -->
Call `myFunction(argument)` here.
````

## Reflowing a document

A lint rule can only edit the line it reports on, so `--fix` breaks after a sentence and
leaves the rest of the old wrapping where it was — one sentence per line,
and a staircase of short lines after it.
Reflowing means unwrapping the block first, which is a formatter's job.

```sh
npx sembr-format doc/*.md
```

It joins each prose block, splits it into sentences, and wraps each one at the latest
boundary of meaning that fits — a clause end within reach, plain filling otherwise.
`SEMBR_WIDTH` sets the target (88 by default).
Headings, tables, code blocks and link definitions are copied through untouched.

**It renders both versions and compares them before writing anything**,
and refuses the file if they differ.
That is not ceremony: writing it turned up a blockquote continuation losing its marker,
a break that left `**` preceded by a space (which stops being emphasis),
a bare `>` line silently merging two paragraphs, and a sentence split inside
`` `overdueMinors !== 0` `` — the splitter does not know Markdown,
so the atoms are masked before it runs.

## Against the specification

[SemBr 1.0](https://sembr.org) states thirteen rules.
What this package covers, and what it does not:

| Spec | | Here |
| --- | --- | --- |
| 4 | A break **MUST** occur after a sentence | `SEMBR003` — the only MUST about placement, and the one rule that can be fixed automatically |
| 2 | A break **MUST NOT** alter the rendered output | Property-tested: the fixes are applied to a corpus and both renderings compared, whitespace collapsed as HTML collapses it |
| 9 | A break **MUST NOT** occur within a hyphenated word | By construction — the fixer only ever breaks after sentence-final punctuation |
| 12, 13 | 80 characters **RECOMMENDED**, longer lines allowed for links and code | Not this package's business: `MD013` with `strict: false` already says exactly that |
| 5 | A break **SHOULD** occur after an independent clause (`,` `;` `:` `—`) | **Not implemented.** Deciding whether a comma separates independent clauses is the part no rule answers |
| 1, 3, 6, 7, 8, 10, 11 | MAY and SHOULD, on grouping and emphasis | Editorial: not machine-checkable |

`SEMBR001`, `SEMBR002` and `SEMBR004` are outside the specification.
It says where a break should fall; they say what a break must not damage on its way.

## What the rules do not read

They run on the micromark token stream, so fenced and indented code blocks,
HTML blocks and tables are skipped whole, and code spans, link destinations,
autolinks and images are masked inside a line before any rule sees it.
Link *text* stays visible: it is prose, and a sentence can end in it.

## Licence

[MIT](LICENSE).
