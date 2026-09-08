/**
 * markdownlint rules in support of semantic line breaks (https://sembr.org).
 *
 * Where a line *should* break is a question of meaning, and no rule answers it.
 * These check what a machine can decide around the break: a line that never
 * broke where a sentence ended, a break that stranded punctuation, a break that
 * split a code span, and the non-breaking spaces that stop a break happening
 * where French typography forbids one.
 *
 * Plain `.mjs`: markdownlint loads the module directly, so a rule that needed a
 * build step would make linting depend on compiling.
 */
import { filterByTypes } from 'markdownlint-rule-helpers/micromark'
import { LEADING_MARKUP, ORPHAN_PUNCTUATION, midLineEnds } from './sentences.mjs'

/**
 * Blocks whose lines are not prose at all. Their content is skipped whole,
 * because a colon in a shell command or a table cell is not a typography
 * mistake.
 */
const SKIPPED_BLOCKS = ['codeFenced', 'codeIndented', 'htmlFlow', 'table']

/**
 * Spans masked inside a line that is otherwise prose. `resource` is the
 * `(destination)` half of a link, so link *text* stays visible — it is prose
 * and it is where a sentence can end.
 */
const MASKED_SPANS = [
  'codeText',
  'resource',
  'definition',
  'reference',
  'autolink',
  'htmlText',
  'image',
]

/** The two spaces French typography distinguishes, named so they stay visible. */
const NBSP = '\u00a0'
const THIN_NBSP = '\u202f'

/** Filler that keeps every offset intact and carries no punctuation. */
const FILLER = 'x'

/**
 * The document as prose: one entry per line, `null` where the line is not prose
 * at all, and non-prose spans replaced character for character.
 *
 * Masking rather than dropping is what lets a rule report a column: an offset
 * read from this view addresses the same character in the source, which is what
 * `fixInfo` needs.
 */
function proseLines(params) {
  const { tokens } = params.parsers.micromark
  const skipped = new Set()
  for (const token of filterByTypes(tokens, SKIPPED_BLOCKS)) {
    for (let line = token.startLine; line <= token.endLine; line++) skipped.add(line)
  }
  const lines = params.lines.map((line, index) => (skipped.has(index + 1) ? null : line))
  for (const token of filterByTypes(tokens, MASKED_SPANS)) {
    for (let line = token.startLine; line <= token.endLine; line++) {
      const index = line - 1
      const source = lines[index]
      if (source === null || source === undefined) continue
      const from = line === token.startLine ? token.startColumn - 1 : 0
      const to = line === token.endLine ? token.endColumn - 1 : source.length
      lines[index] = source.slice(0, from) + FILLER.repeat(to - from) + source.slice(to)
    }
  }
  return lines
}

/** Walk the prose lines, giving each rule the masked text and the source. */
function eachProseLine(params, visit) {
  const masked = proseLines(params)
  masked.forEach((line, index) => {
    if (line === null || line.trim() === '') return
    visit(line, params.lines[index], index + 1)
  })
}

const orphanPunctuation = {
  names: ['SEMBR001', 'sembr-orphan-punctuation'],
  description: 'Line starts with punctuation that belongs to the previous line',
  tags: ['whitespace', 'sembr'],
  parser: 'micromark',
  function: (params, onError) => {
    eachProseLine(params, (masked, source, lineNumber) => {
      const prefix = LEADING_MARKUP.exec(masked)?.[0].length ?? 0
      const character = masked[prefix]
      if (character && ORPHAN_PUNCTUATION.includes(character)) {
        onError({
          lineNumber,
          detail: `The line opens on "${character}", so the break came one character too early`,
          context: source.trim().slice(0, 40),
        })
      }
    })
  },
}

const nonBreakingSpace = {
  names: ['SEMBR002', 'sembr-non-breaking-space'],
  description: 'Ordinary space where French typography requires a non-breaking one',
  tags: ['whitespace', 'sembr'],
  parser: 'micromark',
  function: (params, onError) => {
    eachProseLine(params, (masked, source, lineNumber) => {
      // An ordinary space before these is wrong in French (the line may break
      // there) and does not occur in English, so one rule serves both.
      for (const match of masked.matchAll(/ ([;:!?%»])/g)) {
        onError({
          lineNumber,
          detail: `An ordinary space precedes "${match[1]}": use U+00A0 (: ») or U+202F (; ! ? %)`,
          context: source.slice(Math.max(0, match.index - 20), match.index + 20).trim(),
          fixInfo: {
            editColumn: match.index + 1,
            deleteCount: 1,
            insertText: ';!?%'.includes(match[1]) ? THIN_NBSP : NBSP,
          },
        })
      }
      for (const match of masked.matchAll(/« /g)) {
        onError({
          lineNumber,
          detail: 'An ordinary space follows "«": use U+00A0',
          context: source.slice(Math.max(0, match.index - 10), match.index + 30).trim(),
          fixInfo: { editColumn: match.index + 2, deleteCount: 1, insertText: NBSP },
        })
      }
    })
  },
}

/** What a wrapped line has to repeat to stay in the same block. */
function continuationPrefix(source) {
  const [, quote = '', bullet = ''] = LEADING_MARKUP.exec(source) ?? []
  return quote + ' '.repeat(bullet.length)
}

const oneSentencePerLine = {
  names: ['SEMBR003', 'sembr-one-sentence-per-line'],
  description: 'A sentence ends mid-line: start the next one on its own line',
  tags: ['sembr'],
  parser: 'micromark',
  function: (params, onError) => {
    // Mid-line sentence ends come from `midLineEnds` — the same predicate the
    // formatter's self-check uses, over `sentencesOf` with the configured
    // abbreviations and the shared stitching, so a line the formatter emits is a
    // line this rule accepts. The default list is English-plus-French;
    // `abbreviations` adds to it rather than replacing it.
    const extra = Array.isArray(params.config.abbreviations) ? params.config.abbreviations : []
    const headings = new Set()
    for (const token of filterByTypes(params.parsers.micromark.tokens, ['atxHeading'])) {
      for (let line = token.startLine; line <= token.endLine; line++) headings.add(line)
    }

    eachProseLine(params, (masked, source, lineNumber) => {
      // A heading is one unit and cannot be split, whatever punctuation it holds.
      if (headings.has(lineNumber)) return
      for (const { end, gap } of midLineEnds(masked, extra)) {
        onError({
          lineNumber,
          detail: 'The sentence ends here — the next one starts a new line',
          context: source.slice(Math.max(0, end - 25), end + 15).trim(),
          fixInfo: {
            editColumn: end + 1,
            deleteCount: gap.length,
            insertText: `\n${continuationPrefix(source)}`,
          },
        })
        // One break per pass: the columns after it belong to a line that does
        // not exist yet, and `--fix` will come round again.
        return
      }
    })
  },
}

const splitInlineSpan = {
  names: ['SEMBR004', 'sembr-split-inline-span'],
  description: 'A code span is split across lines',
  tags: ['code', 'sembr'],
  parser: 'micromark',
  function: (params, onError) => {
    for (const token of filterByTypes(params.parsers.micromark.tokens, ['codeText'])) {
      if (token.startLine === token.endLine) continue
      onError({
        lineNumber: token.startLine,
        detail: 'The code span continues on the next line: it survives rendering, not a search',
        context: params.lines[token.startLine - 1].trim().slice(0, 40),
      })
    }
  },
}

export default [orphanPunctuation, nonBreakingSpace, oneSentencePerLine, splitInlineSpan]
