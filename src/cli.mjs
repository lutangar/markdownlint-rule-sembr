#!/usr/bin/env node
/**
 * `sembr-format file…` — reflow each file to semantic line breaks in place.
 *
 * A thin bin around `format`: read, reflow, and write only when the rendered
 * document is unchanged (SemBr rule 2). Kept separate from `format.mjs` so that
 * module stays a pure, importable pair of functions with no argv or I/O.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { format, render } from './format.mjs'

let skipped = 0
for (const file of process.argv.slice(2)) {
  // One file's failure — unreadable, unwritable, or a reflow that changes the
  // render — is counted and skipped, never fatal, so a batch (a pre-commit hook
  // over the changed files) always processes every file. The read is not the
  // only thing that can throw: format/render and the write are inside too.
  try {
    const source = readFileSync(file, 'utf8')
    const formatted = format(source)
    if (render(formatted) !== render(source)) {
      console.error(`${file}: REFUSÉ — le rendu change`)
      skipped++
      continue
    }
    if (formatted !== source) writeFileSync(file, formatted)
    const long = formatted
      .split('\n')
      .filter((line) => line.length > 100 && !line.trimStart().startsWith('|'))
    console.log(
      `${file}: ${source.split('\n').length} → ${formatted.split('\n').length} lignes, ` +
        `${long.length} au-dessus de 100`,
    )
  } catch (error) {
    console.error(`${file}: ${error.message}`)
    skipped++
  }
}
process.exit(skipped > 0 ? 1 : 0)
