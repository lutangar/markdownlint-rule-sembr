import { lint } from 'markdownlint/promise'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM JavaScript, shipped as-is.
import { format, render } from './format.mjs'
// @ts-expect-error — plain ESM JavaScript, shipped as-is.
import rules from './index.mjs'

/** Every reflow must leave the rendered document identical (SemBr rule 2). */
const stable = (source: string) => {
  const out = format(source)
  expect(render(out)).toBe(render(source))
  return out
}

/**
 * The lockstep contract: what the formatter emits, the rules accept. Run under
 * the DEFAULT sembr configuration — no per-test abbreviations — because that is
 * the configuration a divergence would slip through.
 */
async function sembrErrors(markdown: string) {
  const results = await lint({
    strings: { doc: markdown },
    customRules: rules,
    config: { default: false, sembr: true, SEMBR002: false },
  })
  return results.doc
}

const lockstep = async (source: string) => {
  const out = stable(source)
  expect(await sembrErrors(out)).toHaveLength(0)
  return out
}

describe('format — reflow to semantic line breaks', () => {
  it('breaks after a sentence and unwraps the old fill', async () => {
    expect(await lockstep('Une phrase. Une deuxième phrase courte.')).toBe(
      'Une phrase.\nUne deuxième phrase courte.',
    )
  })

  it('leaves YAML front matter untouched, reflows the body', async () => {
    const out = await lockstep('---\nname: x\ntitle: y\n---\n\nUne phrase. Une autre.')
    expect(out.startsWith('---\nname: x\ntitle: y\n---\n')).toBe(true)
    expect(out).toContain('Une phrase.\nUne autre.')
  })

  it('reflows a body between a thematic break and a later one', async () => {
    // Leading `---` + a blank line is a rule, not front matter: the block must
    // still break into sentences.
    expect(
      await lockstep('---\n\nChapitre un. Du texte ici.\n\n---\n\nChapitre deux. Encore.'),
    ).toContain('Chapitre un.\nDu texte ici.')
  })

  it('never opens a line on French clitic or closing punctuation', async () => {
    const long =
      'Un début assez long pour forcer un repli quelque part au milieu de la ligne' +
      ' entière ( oui ) ; une suite tout aussi longue derrière le point-virgule ici.'
    for (const line of (await lockstep(long)).split('\n')) {
      expect(line.trimStart()).not.toMatch(/^[;:!?»,)]/)
    }
  })

  it('keeps a bold question whole and renders it as emphasis', async () => {
    const out = await lockstep('**Qui possède le port ?** La couture k8s tranche la question.')
    expect(render(out)).toContain('<strong>Qui possède le port ?</strong>')
  })

  it('closes an underscore span opened before an internal question mark', async () => {
    const out = await lockstep('_Qui possède le port ?_ La couture k8s tranche la question ici.')
    expect(render(out)).toContain('<em>Qui possède le port ?</em>')
  })

  it('starts a fresh bold sentence on its own line', async () => {
    const out = await lockstep(
      'IPv4 fixe (relevé 2026-08). **Pas de CGNAT** : ports 0-65535 ouverts vraiment.',
    )
    expect(out).toMatch(/\n\*\*Pas de CGNAT\*\*/)
  })

  it('does not glue two sentences around a literal asterisk', async () => {
    const out = await lockstep('Un calcul 5 * 3 fait quinze. Ensuite une autre phrase distincte.')
    expect(out).toMatch(/quinze\.\nEnsuite/)
  })

  it('escapes a leading bullet marker so it stays prose, not a list', async () => {
    const out = await lockstep('Design-first et revue. + 2FA vérifiée sur les six applications.')
    expect(out).toMatch(/\n\\\+ 2FA/)
    expect(render(out)).not.toContain('<ul>')
  })

  it('escapes a leading heading run, not only a single hash', async () => {
    const out = await lockstep('Voir la documentation complète ici. ## Titre reste de la prose.')
    expect(render(out)).not.toContain('<h2>')
  })

  it('keeps a numbered clause off the start of a line, without escaping', async () => {
    // `d'étape 1.` must not wrap so `1.` opens a line (an ordered list) — and it
    // is glued, not escaped: `1\.` would read as its own sentence to SEMBR003.
    const out = await lockstep(
      'Le cross-mapping artificiel du test se règle à l’étape 1. Ensuite une autre ' +
        'phrase bien distincte vient conclure le paragraphe proprement.',
    )
    expect(out).not.toContain('\\1')
    expect(render(out)).not.toContain('<ol>')
  })

  it('keeps an abbreviation before a proper noun on one line, default config', async () => {
    // `cf. ADR-0065` must not split — and with no per-test abbreviations, proving
    // the formatter and the rule share the same default list.
    const out = await lockstep('Le transcode est servi par Caddy, cf. ADR-0065 pour le détail.')
    expect(out).not.toMatch(/cf\.\s*$/m)
  })

  it('pulls a closing » back onto the sentence it closes', async () => {
    const out = await lockstep('On rappelle : « tout est chiffré au repos. » La suite ensuite.')
    for (const line of out.split('\n')) expect(line.trimStart()).not.toMatch(/^»/)
  })

  it('splits around a literal asterisk while keeping real emphasis whole', async () => {
    const out = await lockstep('Un calcul 5 * 3 fait quinze. *Attention* à ce point précis ici.')
    expect(out).toMatch(/quinze\.\n\*Attention\*/)
  })

  it('keeps a strong span spanning two sentences on one line', async () => {
    const out = await lockstep('**Est-ce A ? Ou plutôt B ?** La réponse vient ensuite.')
    expect(render(out)).toContain('<strong>Est-ce A ? Ou plutôt B ?</strong>')
  })

  it('does not treat a snake_case underscore as emphasis', async () => {
    const out = await lockstep('config_prod échoue souvent hier soir. _Voici_ la raison.')
    expect(out).toMatch(/soir\.\n_Voici_/)
  })

  it('escapes a leading > run even with no following space', async () => {
    const out = await lockstep('Une première phrase ici. >>flux enchaîne les étapes.')
    expect(render(out)).not.toContain('<blockquote>')
  })

  it('leaves a setext heading and its underline untouched', async () => {
    const out = await lockstep('Mon Titre De Section\n---\n\nUn paragraphe de texte ici.')
    expect(out).toContain('Mon Titre De Section\n---')
  })

  it('reflows around a thematic break without absorbing it', async () => {
    const out = await lockstep(
      'Chapitre un du texte. Deux phrases ici présentes.\n\n---\n\nChapitre deux ensuite.',
    )
    expect(out).toContain('\n\n---\n\n')
    expect(out).toContain('Chapitre un du texte.\nDeux phrases ici présentes.')
  })

  it('never breaks inside an emphasis span wider than the wrap width', async () => {
    // The span is >88 columns and holds a `?`; wrapping inside it would strand
    // its opening `**` and SEMBR003 would flag the re-exposed boundary.
    const out = await lockstep(
      '**Le port 443 est-il vraiment ouvert sur cette machine précise ? La couture ' +
        'k8s tranche enfin la question ici.** On vérifie ensuite le reste.',
    )
    expect(render(out)).toContain('<strong>')
  })

  it('leaves a single-character setext underline and its title alone', async () => {
    const out = await lockstep('Titre de niveau un\n=\n\nUn paragraphe de texte ici.')
    expect(out).toContain('Titre de niveau un\n=')
  })

  it('preserves a hard line break instead of reflowing it away', async () => {
    const source = 'Une phrase avec un retour dur.  \nLa ligne suivante reste distincte.'
    const out = await lockstep(source)
    expect(out).toBe(source)
  })

  it('keeps YAML front matter with a blank line intact', async () => {
    const out = await lockstep(
      '---\ntitle: Post\ndate: 2026-01-01\n\ntags:\n  - foo\n---\n\nLe corps. Deux phrases.',
    )
    expect(out).toContain('date: 2026-01-01')
    expect(out).toContain('Le corps.\nDeux phrases.')
  })

  it('reflows an alert body one-sentence-per-line, marker kept alone', async () => {
    const out = await lockstep('> [!WARNING]\n> Attention absolue ici. Et une deuxième phrase.')
    expect(out).toContain('> [!WARNING]\n> ')
    expect(out).toMatch(/ici\.\n> Et/)
  })

  it('reflows around a hard line break instead of skipping the block', async () => {
    const out = await lockstep('Une phrase. Une deuxième phrase distincte.  \nLa suite reste ici.')
    expect(out).toContain('  \n')
    expect(out).toMatch(/Une phrase\.\nUne deuxième/)
  })

  it('sees emphasis on an indented list continuation, not indented code', async () => {
    const out = await lockstep('10. Un début de phrase ici. *Deux. Phrases* ici bien maintenant.')
    expect(render(out)).toContain('<em>Deux. Phrases</em>')
  })

  it('keeps a number ending a list-item continuation line, not a phantom bullet', async () => {
    // A continuation line opening `403. …` or `2023) …` is prose: an ordered list
    // cannot interrupt a paragraph, so stripping it as a bullet drops the number.
    const out = await lockstep(
      '- Un service exposé publiquement sans le tunnel actif renvoie une erreur →\n' +
        '  403. La suite du raisonnement occupe encore un bon bout de la phrase ici.',
    )
    expect(out).toContain('403.')
    expect(render(out)).toContain('403.')
  })

  it('pulls a closing » and its trailing stop onto the sentence, no orphan dot', async () => {
    // `« … ».` splits to a `».` fragment the closer must swallow whole, or a lone
    // `.` is stranded on its own line and the render gains a space before it.
    const out = await lockstep(
      "On veut « traduire ce qu'on régénère ». La phrase suivante arrive ici.",
    )
    expect(render(out)).not.toContain(' . ')
    for (const line of out.split('\n')) expect(line.trimStart()).not.toMatch(/^[».]/)
  })

  it('never opens a wrapped line on a closing » carried past the width', async () => {
    // Long enough that the wrap must break, with the quote closing right at the
    // seam: `».` must ride back, never open the continuation line (SEMBR001).
    const out = await lockstep(
      '- Le petit outil maison réutilise la bibliothèque interne déjà en place, si le service' +
        " externe ne couvre pas le cas « traduire un sous-titre qu'on vient de régénérer ».",
    )
    for (const line of out.split('\n')) expect(line.trimStart()).not.toMatch(/^»/)
  })

  it('stops wrapping a sentence when a clause break would expose an interior boundary', async () => {
    // The parenthetical holds a `?`; wrapped, a line would start `vidéo ?)` and the
    // rule reads it as a whole question. The sentence is emitted unbroken instead.
    const out = await lockstep(
      '- **Gate** (le sous-titre récupéré appartient-il bien à la vidéo ?) puis un contrôle' +
        ' de synchronisation vient ensuite confirmer que tout est correct ici maintenant.',
    )
    expect(render(out)).toContain('vidéo ?)')
  })

  it('stops wrapping around an interior parenthetical question list', async () => {
    const out = await lockstep(
      '- Il pose deux questions bien personnelles à la toute fin du message reçu hier soir' +
        ' (fin de La Filature ? vente de poivre ?).',
    )
    expect(render(out)).toContain('poivre ?)')
  })

  it('carries a French-spaced mark after a closer, never onto its own line', async () => {
    // `« … » !` sets a space before the `!` (French typography); the closer must
    // still swallow it, or the `!` is stranded on a line (SEMBR001).
    const out = await lockstep('Il a dit « Wha ? » ! La conversation reprend juste après ici.')
    for (const line of out.split('\n')) expect(line.trimStart()).not.toMatch(/^[!»]/)
  })

  it('copies unclosed front matter verbatim instead of merging the keys as prose', async () => {
    // micromark has no front-matter extension here, so an opener with no closing
    // `---` reads as a paragraph; reflowing it would merge separate keys onto one
    // line — broken YAML the render check cannot see. The keys stay untouched.
    const out = await lockstep(
      '---\ntitle: Hello World\nauthor: Jane Doe\n\nLe corps. Deux phrases.',
    )
    expect(out).toContain('title: Hello World\nauthor: Jane Doe')
    expect(out).toContain('Le corps.\nDeux phrases.')
  })

  it('restores emphasis nested inside a link, not a leaked placeholder', async () => {
    // Emphasis is masked before the link around it, so the link atom holds the
    // emphasis placeholder; a single restore pass would leak a private-use char.
    const out = await lockstep('Voir [**gras** ici](http://x) pour comprendre la suite du propos.')
    expect(render(out)).toContain('<strong>gras</strong>')
    expect(out).not.toMatch(/[]/)
  })

  it('masks an inline HTML comment so its punctuation is not a sentence break', async () => {
    const out = await lockstep(
      'Le texte continue <!-- prettier-ignore --> et se poursuit encore un long moment tranquille ici.',
    )
    expect(out).toContain('<!-- prettier-ignore -->')
  })

  it('keeps an inline triple-backtick run off a line start, not a code fence', async () => {
    const out = await lockstep(
      'Un exemple de trois backticks ``` au beau milieu du texte qui doit vraiment rester ' +
        'littéral et inline sans jamais ouvrir de bloc de code ici.',
    )
    expect(render(out)).not.toContain('<pre>')
  })

  it('pulls a clitic colon opening a fragment back onto the previous line', async () => {
    const out = await lockstep(
      'Fin. : suite un peu plus longue pour la lisibilité de la ligne ici.',
    )
    for (const line of out.split('\n')) expect(line.trimStart()).not.toMatch(/^:/)
  })

  it('does not drop a standalone punctuation mark between two sentences', async () => {
    const out = await lockstep('Il crie très fort. ! et la foule lui répond aussitôt en écho ici.')
    expect(render(out)).toContain('!')
    expect(out).toMatch(/fort\. !/)
  })

  it('preserves CRLF line endings rather than rewriting the whole file to LF', () => {
    const out = format('Une phrase. Une deuxième phrase bien distincte.\r\nLa suite reste ici.')
    expect(out).toContain('\r\n')
    expect(out).not.toMatch(/[^\r]\n/)
  })
})
