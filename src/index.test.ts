import { readFileSync } from 'node:fs'
import { applyFixes } from 'markdownlint'
import { lint } from 'markdownlint/promise'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM JavaScript, shipped as-is.
import { render } from './format.mjs'
// @ts-expect-error — the rules are plain ESM JavaScript, shipped as-is.
import rules from './index.mjs'

const NBSP = ' '
const THIN_NBSP = ' '

// `render` — the document as the reader sees it, which no fix may change — is
// imported from the formatter so the rule tests and the shipped code agree on
// what "the rendered output" is.

/** Run one rule over a document and return what it reported. */
async function check(rule: string, markdown: string, config: Record<string, unknown> = {}) {
  const results = await lint({
    strings: { doc: markdown },
    customRules: rules,
    config: { default: false, [rule]: Object.keys(config).length > 0 ? config : true },
  })
  return results.doc
}

/** Run one rule and apply every fix it offers, as `--fix` would. */
async function fix(rule: string, markdown: string) {
  return applyFixes(markdown, await check(rule, markdown))
}

describe('SEMBR001 — orphan punctuation', () => {
  it('reports a line opening on punctuation the previous one lost', async () => {
    expect(await check('SEMBR001', 'Une phrase coupée\n: trop tôt.')).toHaveLength(1)
  })

  it('leaves a line that opens on a word alone', async () => {
    expect(await check('SEMBR001', 'Une phrase coupée\nau bon endroit.')).toHaveLength(0)
  })

  it('ignores a code block indented inside a list item', async () => {
    // The reason these rules read micromark tokens rather than the raw lines:
    // an indented block inside a list is code, and a hand-rolled line scan
    // cannot tell it from a wrapped paragraph.
    const doc = ['- Une étape :', '', '      : pas de la prose', ''].join('\n')
    expect(await check('SEMBR001', doc)).toHaveLength(0)
  })
})

describe('SEMBR002 — non-breaking spaces', () => {
  it('reports an ordinary space before French punctuation, and fixes it', async () => {
    const doc = 'Deux règles : une ; et une autre !'
    expect(await check('SEMBR002', doc)).toHaveLength(3)
    expect(await fix('SEMBR002', doc)).toBe(
      `Deux règles${NBSP}: une${THIN_NBSP}; et une autre${THIN_NBSP}!`,
    )
  })

  it('fixes the space inside French quotation marks', async () => {
    expect(await fix('SEMBR002', 'Il a dit « oui » hier.')).toBe(
      `Il a dit «${NBSP}oui${NBSP}» hier.`,
    )
  })

  it('says nothing about a colon inside a code span', async () => {
    expect(await check('SEMBR002', 'La valeur `{ a : 1 }` est un objet.')).toHaveLength(0)
  })

  it('does not read the "!" of an image as punctuation', async () => {
    expect(await check('SEMBR002', 'Une capture ![écran](a.png) ici.')).toHaveLength(0)
  })

  it('leaves an English line alone', async () => {
    expect(await check('SEMBR002', 'Two rules: one, and another.')).toHaveLength(0)
  })
})

describe('SEMBR003 — one sentence per line', () => {
  it('reports a sentence ending mid-line and breaks it', async () => {
    const doc = 'La première. La seconde.'
    expect(await check('SEMBR003', doc)).toHaveLength(1)
    expect(await fix('SEMBR003', doc)).toBe('La première.\nLa seconde.')
  })

  it('repeats the list marker width so the break stays inside the item', async () => {
    expect(await fix('SEMBR003', '- La première. La seconde.')).toBe(
      '- La première.\n  La seconde.',
    )
  })

  it('knows an abbreviation is not the end of a sentence', async () => {
    expect(await check('SEMBR003', 'Voir e.g. la version 0.2.0. Elle commande.')).toHaveLength(1)
  })

  it('takes extra abbreviations from the configuration', async () => {
    // `chap.` is not in the default list, so `chap. Trois` splits — until the
    // configuration adds it.
    const doc = 'Voir chap. Trois du manuel pour la suite.'
    expect(await check('SEMBR003', doc)).toHaveLength(1)
    expect(await check('SEMBR003', doc, { abbreviations: ['chap.'] })).toHaveLength(0)
  })

  it('does not split a default abbreviation before a capitalised word', async () => {
    // `sentence-splitter` ends a sentence at `cf.` when a capital follows, taking
    // the proper noun for a new sentence. A known abbreviation stitches it back,
    // and `cf.` is one by default — so with no configuration the rule and the
    // formatter (which keeps them together) agree.
    const doc = 'Servi par Caddy, cf. ADR-0065 pour le détail.'
    expect(await check('SEMBR003', doc)).toHaveLength(0)
  })

  it('still sees a real sentence end that precedes an abbreviation tail', async () => {
    const doc = 'Le transcode est servi. cf. ADR-0065 pour le détail.'
    expect(await check('SEMBR003', doc)).toHaveLength(1)
  })

  it('does not swallow a French break at an English abbreviation look-alike', async () => {
    // `No.` and friends are in sentence-splitter's default English list but not
    // ours: a French sentence ending on such a token before a capital is a real
    // break, not an abbreviation.
    const doc = 'On garde le paragraphe No. Cela arrive de temps en temps.'
    expect(await check('SEMBR003', doc)).toHaveLength(1)
  })

  it('leaves a heading alone: it is one unit whatever it contains', async () => {
    expect(await check('SEMBR003', '# Un titre. Avec deux phrases.')).toHaveLength(0)
  })

  it('says nothing about a full stop inside a link destination', async () => {
    expect(
      await check('SEMBR003', 'Voir [la page](https://x.example/a.b c.d) pour la suite.'),
    ).toHaveLength(0)
  })

  it('keeps a French-spaced mark riding on a closer inside one sentence', async () => {
    // `« … » !` sets a space before the `!`; the closer run must swallow it, or
    // the stranded `!` reads as a boundary and the single sentence is falsely
    // split.
    expect(
      await check('SEMBR003', 'Un aparté (voir « ça » !) puis la suite continue ici.'),
    ).toHaveLength(0)
  })
})

describe('SEMBR004 — split code span', () => {
  it('reports a code span that continues on the next line', async () => {
    expect(await check('SEMBR004', 'Appeler `maFonction(\nargument)` ici.')).toHaveLength(1)
  })

  it('reports a double-backtick span too', async () => {
    // A backtick count cannot see this one, which is why the rule reads tokens.
    expect(await check('SEMBR004', 'Appeler ``a`b\nc`` ici.')).toHaveLength(1)
  })

  it('leaves a fenced block alone', async () => {
    expect(await check('SEMBR004', '```js\nconst a = 1\n```')).toHaveLength(0)
  })
})

describe('corpus', () => {
  // Prose written before the rules existed, by someone not thinking about them:
  // invented examples agree with the rule that produced them, real text does not.
  const corpus = readFileSync(new URL('./fixtures/corpus.md', import.meta.url), 'utf8')

  it('reports the French spacing, and only where it is missing', async () => {
    const errors = await check('SEMBR002', corpus)
    // Two colons and two list semicolons — and nothing from the table, the code
    // block, the link or the image, which all carry the same punctuation.
    expect(errors.map((error) => error.lineNumber)).toEqual([21, 24, 26, 27])
  })

  it('sees every sentence that ends mid-line, and no heading', async () => {
    const errors = await check('SEMBR003', corpus)
    // Four prose lines. Not the semicolon on line 15, which ends a clause and
    // not a sentence; not the headings; not the table row that reads like one.
    expect(errors.map((error) => error.lineNumber)).toEqual([4, 10, 11, 14, 21])
  })

  it('finds nothing to say about breaks that were made correctly', async () => {
    expect(await check('SEMBR001', corpus)).toHaveLength(0)
    expect(await check('SEMBR004', corpus)).toHaveLength(0)
  })

  it("leaves the rendered output untouched — the specification's only MUST NOT", async () => {
    // SemBr 1.0, rule 2: "A semantic line break MUST NOT alter the final
    // rendered output of the document." Both fixable rules are checked against
    // the renderer rather than against a reading of the code.
    const fixed = applyFixes(corpus, [
      ...(await check('SEMBR002', corpus)),
      ...(await check('SEMBR003', corpus)),
    ])
    expect(fixed).not.toBe(corpus)
    expect(render(fixed)).toBe(render(corpus))
  })
})

describe('SEMBR003 — the per-line/whole-block seam', () => {
  it('is stricter on hand-written multi-line emphasis by design', async () => {
    // Lockstep is on FORMATTER output: the formatter never breaks inside an
    // emphasis span. When a human wraps one across lines, the span is unclosed on
    // line 1, so the shared splitter cannot see it there and the rule flags the
    // mid-line end. Pinned so nobody "relaxes" the rule to match the formatter.
    expect(await check('SEMBR003', '**Deux phrases. Ici\nsuite** ok.')).toHaveLength(1)
    // The same content on one line — the span closed — is not flagged.
    expect(await check('SEMBR003', '**Deux phrases. Ici** puis une suite.')).toHaveLength(0)
  })

  it('reads a masked code span inside emphasis as a word (FILLER stays a word char)', async () => {
    // sentencesOf runs micromark on the text the rule masks — a code span becomes
    // a run of word-char 'x'. A boundary inside a strong span that also holds a
    // code span must still count as inside, so the rule does not flag it. If
    // FILLER ever became punctuation or space, this would break.
    const doc = 'La règle **tient `même. ici` toujours** dans un cas précis.'
    expect(await check('SEMBR003', doc)).toHaveLength(0)
  })
})
