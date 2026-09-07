import { applyFixes } from 'markdownlint'
import { lint } from 'markdownlint/promise'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — the rules are plain ESM JavaScript, shipped as-is.
import rules from './index.mjs'

const NBSP = ' '
const THIN_NBSP = ' '

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
    const doc = 'Voir p. ex. cette page.'
    expect(await check('SEMBR003', doc)).toHaveLength(1)
    expect(await check('SEMBR003', doc, { abbreviations: ['p.', 'ex.'] })).toHaveLength(0)
  })

  it('leaves a heading alone: it is one unit whatever it contains', async () => {
    expect(await check('SEMBR003', '# Un titre. Avec deux phrases.')).toHaveLength(0)
  })

  it('says nothing about a full stop inside a link destination', async () => {
    expect(
      await check('SEMBR003', 'Voir [la page](https://x.example/a.b c.d) pour la suite.'),
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
