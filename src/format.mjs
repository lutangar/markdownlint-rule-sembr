#!/usr/bin/env node
/**
 * One-shot formatter: semantic line breaks over a whole document.
 *
 * The lint rule can only edit the line it reports on, so `--fix` breaks after a
 * sentence and leaves the rest of the old wrapping where it was. Reflowing means
 * unwrapping the block first, and that is a formatter's job, not a linter's.
 *
 * Each prose block is joined, split into sentences, and each sentence wrapped at
 * the latest boundary of meaning that fits — a clause end if there is one within
 * reach, plain filling otherwise. Code, tables, headings and link definitions
 * are copied through untouched, and the result is rendered and compared with the
 * source before anything is written.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { DefaultAbbrMarkerOptions, split as splitSentences } from 'sentence-splitter'

const WIDTH = Number(process.env.SEMBR_WIDTH ?? 88)
const LOOKBACK = 30
const ABBREVIATIONS = ['p.', 'ex.', 'cf.', 'réf.', 'env.', 'M.', 'Mme', 'éd.']
const OPTIONS = {
  AbbrMarker: {
    language: {
      ...DefaultAbbrMarkerOptions.language,
      ABBREVIATIONS: [...DefaultAbbrMarkerOptions.language.ABBREVIATIONS, ...ABBREVIATIONS],
    },
  },
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const OPAQUE = /^(\s{0,3}\||\s{0,3}#|\s{4,}|\s{0,3}\[[^\]]+\]:|<)/
/**
 * A GitHub/GitLab alert marker, which must stay alone on its line or the
 * alert stops being one. Invisible to the rendering check: micromark does not
 * implement that extension, so both versions come out identical.
 */
const ALERT = /^\s*>\s*\[!\w+\]\s*$/
const LEAD = /^(\s*(?:>\s*)*)((?:[-*+]|\d+[.)])\s+)?/
const BOUNDARY = /[.;:,—»)]$/
// A code span is delimited by a run of backticks and ends at the next run of
// the same length: ``a `b` c`` is one atom, not three.
const ATOM = /(`+)[\s\S]*?\1(?!`)|!?\[[^\]]*\]\([^)]*\)|<[^>\s]*>/g

/**
 * Hide code spans, links and images behind a placeholder.
 *
 * Done before the sentences are split, not only before the wrapping: the
 * splitter does not know Markdown, and `!` inside `overdueMinors !== 0` reads to
 * it as the end of a sentence.
 *
 * The delimiters are private-use characters. A bare index would be
 * indistinguishable from a number in the prose, and `12 mois` would come back as
 * whatever atom happened to be twelfth.
 */
const OPEN = '\ue000'
const CLOSE = '\ue001'
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g')

function mask(text) {
  const kept = []
  const masked = text.replace(ATOM, (match) => {
    kept.push(match)
    return `${OPEN}${kept.length - 1}${CLOSE}`
  })
  return { masked, restore: (t) => t.replace(PLACEHOLDER, (_, i) => kept[Number(i)]) }
}

/** Wrap one sentence, preferring the latest clause boundary that fits. */
function wrap(text, firstPrefix, contPrefix, restore) {
  const lines = []
  let current = []
  let prefix = firstPrefix
  for (const token of text
    .split(' ')
    .filter((t) => t !== '')
    .map(restore)) {
    if (current.length > 0 && `${prefix}${[...current, token].join(' ')}`.length > WIDTH) {
      let cut = current.length
      for (let i = current.length - 1; i > 0; i--) {
        if (`${prefix}${current.slice(0, i).join(' ')}`.length < WIDTH - LOOKBACK) break
        if (BOUNDARY.test(current[i - 1])) {
          cut = i
          break
        }
      }
      lines.push(prefix + current.slice(0, cut).join(' '))
      current = current.slice(cut)
      prefix = contPrefix
    }
    current.push(token)
  }
  if (current.length > 0) lines.push(prefix + current.join(' '))
  return lines
}

/** Emit one joined prose block as semantic lines. */
function emit(block) {
  const [lead = '', quote = '', bullet = ''] = LEAD.exec(block[0]) ?? []
  const cont = quote + ' '.repeat(bullet.length)
  // Every line loses its own markup, not just the first: a continuation line
  // that keeps its `>` puts the marker in the middle of the sentence.
  const joined = block
    .map((line, index) => {
      const [own = ''] = LEAD.exec(line) ?? []
      return index === 0 ? line.slice(lead.length) : line.slice(own.length).trim()
    })
    .join(' ')
  // A sentence that starts on a marker is not a sentence: the emphasis it closes
  // opened in the previous one, and a break there would leave `**` preceded by a
  // space, which CommonMark no longer reads as emphasis at all.
  const { masked, restore } = mask(joined)
  const sentences = []
  let previousEnd = 0
  for (const node of splitSentences(masked, OPTIONS)) {
    if (node.type !== 'Sentence') continue
    const [start, end] = node.range
    if (sentences.length > 0 && /^[*_`)\]»"']/.test(node.raw)) {
      // The separator is whatever stood there: `? **` and `?**` do not mean the
      // same thing, and inventing a space turns emphasis into two asterisks.
      sentences[sentences.length - 1] += masked.slice(previousEnd, start) + node.raw
    } else {
      sentences.push(node.raw)
    }
    previousEnd = end
  }
  const out = []
  for (const sentence of sentences) {
    out.push(...wrap(sentence, out.length === 0 ? lead : cont, cont, restore))
  }
  return out.length > 0 ? out : block
}

function format(source) {
  const out = []
  let block = []
  let fence = null
  const flush = () => {
    if (block.length > 0) out.push(...emit(block))
    block = []
  }
  for (const line of source.split('\n')) {
    const fenceMatch = FENCE.exec(line)
    if (fence !== null) {
      out.push(line)
      if (fenceMatch?.[1].startsWith(fence)) fence = null
      continue
    }
    if (fenceMatch) {
      flush()
      fence = fenceMatch[1]
      out.push(line)
      continue
    }
    // A line carrying nothing but its markup — `>` alone inside a blockquote —
    // is a paragraph break, not a line of the paragraph above it.
    const [own = ''] = LEAD.exec(line) ?? []
    if (line.slice(own.length).trim() === '' || OPAQUE.test(line) || ALERT.test(line)) {
      flush()
      out.push(line)
      continue
    }
    // A list marker, or a change of blockquote depth, opens a new block.
    const [, quote = '', bullet = ''] = LEAD.exec(line) ?? []
    const [, openQuote = ''] = block.length > 0 ? (LEAD.exec(block[0]) ?? []) : []
    if (bullet !== '' || (block.length > 0 && quote.trim() !== openQuote.trim())) flush()
    block.push(line)
  }
  flush()
  return out.join('\n')
}

/** The document as the reader sees it: insignificant whitespace collapsed. */
const render = (markdown) =>
  micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })
    .split(/(<pre[\s\S]*?<\/pre>)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/\s+/g, ' ')))
    .join('')

for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, 'utf8')
  const formatted = format(source)
  if (render(formatted) !== render(source)) {
    console.error(`${file}: REFUSÉ — le rendu change`)
    continue
  }
  writeFileSync(file, formatted)
  const long = formatted
    .split('\n')
    .filter((line) => line.length > 100 && !line.trimStart().startsWith('|'))
  console.log(
    `${file}: ${source.split('\n').length} → ${formatted.split('\n').length} lignes, ` +
      `${long.length} au-dessus de 100`,
  )
}
