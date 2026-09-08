/**
 * Semantic line breaks over a whole document — the `format` behind `sembr-format`.
 *
 * The lint rule can only edit the line it reports on, so `--fix` breaks after a
 * sentence and leaves the rest of the old wrapping where it was. Reflowing means
 * unwrapping the block first, and that is a formatter's job, not a linter's.
 *
 * Each prose block is joined, split into sentences (via the shared `sentencesOf`,
 * so the result is a line the rule accepts), and each sentence wrapped at the
 * latest boundary of meaning that fits — a clause end if there is one within
 * reach, plain filling otherwise. Code, tables, headings and link definitions are
 * copied through untouched. `format` returns the reflowed text; `render` gives
 * the document as HTML — `cli.mjs` compares the two and only writes when they
 * match.
 */
import { micromark, parse, postprocess, preprocess } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import {
  LEADING_MARKUP as LEAD,
  ORPHAN_PUNCTUATION,
  emphasisSpans,
  midLineEnds,
  sentencesOf,
} from './sentences.mjs'

const WIDTH = Number(process.env.SEMBR_WIDTH ?? 88)
const LOOKBACK = 30

/**
 * A GitHub/GitLab alert marker, which must stay alone on its line or the
 * alert stops being one. micromark does not implement that extension, so it
 * reads `[!NOTE]` as ordinary paragraph text and the render check cannot see the
 * damage — so a paragraph carrying one is copied through untouched.
 */
const ALERT = /^\s*>?\s*\[!\w+\]\s*$/
const BOUNDARY = /[.;:,—»)]$/
/**
 * A code span (a backtick run closed by the next run of the same length: ``a `b`
 * c`` is one atom, not three), a link or image, or inline HTML. The comment, PI
 * and declaration forms come before the bare-tag form, which stops at the first
 * space and would cut `<!-- prettier-ignore -->` at its internal `!`.
 */
const ATOM =
  /(`+)[\s\S]*?\1(?!`)|!?\[[^\]]*\]\([^)]*\)|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![\s\S]*?>|<[^>\s]*>/g

// Placeholder delimiters are private-use characters: a bare index would be
// indistinguishable from a number, and `12 mois` would restore as whatever atom
// happened to be twelfth.
const OPEN = ''
const CLOSE = ''
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g')

/**
 * Hide the spans that must not be split or read as prose behind a placeholder:
 * emphasis/strong first (so a break never strands a `**…**` delimiter), then the
 * code spans, links and images outside them. The splitter does not know Markdown
 * — `!` in `overdueMinors !== 0` reads to it as a sentence end — and a code span
 * inside an emphasis rides along in its atom rather than being masked again.
 */
function mask(text) {
  const kept = []
  const hide = (span) => `${OPEN}${kept.push(span) - 1}${CLOSE}`
  let masked = ''
  let cursor = 0
  for (const [start, end] of emphasisSpans(text).sort((a, b) => a[0] - b[0])) {
    masked += text.slice(cursor, start) + hide(text.slice(start, end))
    cursor = end
  }
  masked += text.slice(cursor)
  masked = masked.replace(ATOM, hide)
  // Fixpoint: emphasis is masked before the link around it, so an atom for
  // `[**gras**](url)` holds the emphasis placeholder inside it and one pass would
  // leave that inner placeholder in the output. Expand until nothing changes —
  // source never carries a private-use char, so a no-op pass is the end.
  const restore = (t) => {
    let text = t
    let previous
    do {
      previous = text
      text = text.replace(PLACEHOLDER, (_, i) => kept[Number(i)])
    } while (text !== previous)
    return text
  }
  return { masked, restore }
}

/**
 * A token whose first character is orphan punctuation must never open a wrapped
 * line — SEMBR001 reads that first character, so `».` and `?)` are as unwelcome
 * as a bare `»`. It is glued onto the word before, the space kept.
 */
const ORPHAN_LEAD = new RegExp(`^[${ORPHAN_PUNCTUATION}]`)
/**
 * A token that is a whole block marker — a bullet `- + *`, a `>` quote, a `#`
 * heading, an ordinal `1.`, a ``` or `~~~` fence — would start that block if a
 * reflow moved it to a line start, changing the render. Glued back inline, not
 * escaped: `1\.` would read to sentence-splitter as its own sentence.
 */
const BLOCK_MARKER = /^(?:[-+*]|>+|#{1,6}|\d{1,9}[.)]|`{3,}|~{3,})$/

/** Tokens for wrapping: words, with anything that must not open a line reattached. */
function tokenize(text, restore) {
  const tokens = []
  for (const token of text
    .split(' ')
    .filter((t) => t !== '')
    .map(restore)) {
    if (tokens.length > 0 && (ORPHAN_LEAD.test(token) || BLOCK_MARKER.test(token))) {
      tokens[tokens.length - 1] += ` ${token}`
    } else {
      tokens.push(token)
    }
  }
  return tokens
}

/**
 * Escape a block marker a reflow left at a body's start so it renders as itself,
 * not a new block: `\## ` is not a heading, `\>> ` not a quote. A `>` run opens a
 * quote with or without a trailing space (escaped unconditionally); a bullet or
 * `#` needs the space (a lookahead). A number is glued by BLOCK_MARKER instead —
 * `1\.` would read as its own sentence to SEMBR003.
 */
function escapeLead(body) {
  return body.replace(/^>+/, '\\$&').replace(/^([-+*]|#{1,6})(?=\s|$)/, '\\$1')
}

/**
 * A code span, masked to the same length so column offsets survive — the way the
 * rule masks it in `proseLines`. Emphasis is left literal, as the rule leaves it.
 */
const CODE_SPAN = /(`+)[\s\S]*?\1(?!`)/g

/**
 * The rule's own verdict on one finished line: would SEMBR001 (a line opening on
 * orphan punctuation) or SEMBR003 (a sentence ending mid-line) flag it? Close to
 * how the rule checks — it masks code spans only, where the rule also masks link
 * destinations and inline HTML; that is the safe direction (this sees more, so it
 * can only over-flag and fall back to a long line, never emit a line the rule
 * rejects). So `wrap` enforces the lockstep by construction rather than predicting
 * sentence-splitter's context behaviour.
 *
 * A boundary inside a parenthetical `( … ? … )` or a bare abbreviation stays
 * mid-sentence in the whole block, but a wrapped line that starts on it reads the
 * fragment as a fresh sentence (it opens on a capital); the same line unbroken
 * keeps the context, so the fallback is to stop wrapping this sentence.
 */
function ruleFlags(line) {
  const masked = line.replace(CODE_SPAN, (span) => 'x'.repeat(span.length))
  const prefix = LEAD.exec(masked)?.[0].length ?? 0
  if (ORPHAN_PUNCTUATION.includes(masked[prefix])) return true // SEMBR001
  return midLineEnds(masked).length > 0 // SEMBR003, read the same way the rule does
}

/**
 * Wrap one sentence, preferring the latest clause boundary that fits — then, if
 * any wrapped line is one the rule would flag, emit the sentence unbroken. A long
 * line is valid semantic-line-break output, and an unbroken sentence carries the
 * context that stops the rule re-splitting it.
 */
function wrap(text, firstPrefix, contPrefix, restore) {
  const tokens = tokenize(text, restore)
  const lines = []
  let current = []
  let prefix = firstPrefix
  for (const token of tokens) {
    if (current.length > 0 && `${prefix}${[...current, token].join(' ')}`.length > WIDTH) {
      let cut = current.length
      for (let i = current.length - 1; i > 0; i--) {
        if (`${prefix}${current.slice(0, i).join(' ')}`.length < WIDTH - LOOKBACK) break
        if (BOUNDARY.test(current[i - 1])) {
          cut = i
          break
        }
      }
      lines.push(prefix + escapeLead(current.slice(0, cut).join(' ')))
      current = current.slice(cut)
      prefix = contPrefix
    }
    current.push(token)
  }
  if (current.length > 0) lines.push(prefix + escapeLead(current.join(' ')))
  if (lines.length > 1 && lines.some(ruleFlags)) {
    return [firstPrefix + escapeLead(tokens.join(' '))]
  }
  return lines
}

/** A hard line break the reflow must keep: two-plus trailing spaces, or a `\`. */
const HARD_BREAK = / {2,}$|\\$/

/**
 * Emit one paragraph block as semantic lines, forced breaks preserved.
 *
 * The block is split into flow segments at forced breaks — a hard line break, and
 * a GitHub/GitLab alert marker (`[!NOTE]`), which must stay alone or it stops
 * being one. Each segment is joined and reflowed; `sentencesOf` has already
 * stitched every seam the rule would re-split on (abbreviations, emphasis spans,
 * closing delimiters), so each node is one line, wrapped where it is too long.
 */
function emit(block) {
  const [lead = '', quote = '', bullet = ''] = LEAD.exec(block[0]) ?? []
  const cont = quote + ' '.repeat(bullet.length)
  const out = []
  let run = []
  const flush = () => {
    if (run.length === 0) return
    const { masked, restore } = mask(run.join(' '))
    for (const node of sentencesOf(masked)) {
      out.push(...wrap(node.raw, out.length === 0 ? lead : cont, cont, restore))
    }
    run = []
  }
  block.forEach((line, index) => {
    if (ALERT.test(line)) {
      flush()
      out.push(line)
      return
    }
    // The first line loses its whole marker (indent + quote + bullet). A
    // continuation loses only its indent and blockquote `>` (group 1) — never a
    // leading `12.` or `3)`, which is prose here: an ordered list cannot
    // interrupt a paragraph, so micromark kept this line inside the paragraph
    // range at all only because its `403. `/`2023) ` is not a list marker.
    const [, quote = ''] = LEAD.exec(line) ?? []
    const content = index === 0 ? line.slice(lead.length) : line.slice(quote.length).trim()
    run.push(content.replace(HARD_BREAK, '').trimEnd())
    const hard = HARD_BREAK.exec(line)
    if (hard) {
      flush()
      if (out.length > 0) out[out.length - 1] += hard[0]
    }
  })
  flush()
  return out.length > 0 ? out : block
}

/**
 * The reflowable prose of `text`: the 1-based line ranges micromark parses as a
 * leaf paragraph. Everything else — headings, code, tables, thematic breaks,
 * HTML, link definitions — is not a paragraph, so the block model is the
 * renderer's and cannot drift from it. A hard break or an alert inside a
 * paragraph is a forced break `emit` keeps, not a reason to skip the block.
 */
function paragraphs(text) {
  const events = postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(text, undefined, true)),
  )
  const ranges = []
  for (const [kind, token] of events) {
    if (kind === 'enter' && token.type === 'paragraph') {
      ranges.push([token.start.line, token.end.line])
    }
  }
  return ranges
}

export function format(source) {
  // Split on every line ending micromark recognises — CRLF, a lone CR, LF — so
  // the line array matches micromark's own line counting (a lone `\r` would
  // otherwise shift paragraph line numbers off the array). Rejoin with the
  // document's dominant ending, so a CRLF file is not silently rewritten to LF.
  const lines = source.split(/\r\n|\r|\n/)
  const crlf = (source.match(/\r\n/g) ?? []).length
  const cr = (source.match(/\r(?!\n)/g) ?? []).length
  const lf = (source.match(/(?<!\r)\n/g) ?? []).length
  const eol = crlf > 0 && crlf >= cr && crlf >= lf ? '\r\n' : cr > lf && cr > 0 ? '\r' : '\n'
  const out = []
  let start = 0
  // YAML front matter (micromark has no front-matter extension wired here): a
  // `---` on line 1 whose next line opens a YAML key, to its closing `---` or the
  // YAML `...` terminator. The key test tells it from a `---` thematic break above
  // prose; blank lines belong in front matter, so the span runs to the close.
  if (/^---\s*$/.test(lines[0] ?? '') && /^[\w.$-]+\s*:(\s|$)/.test(lines[1] ?? '')) {
    const close = lines.findIndex((line, index) => index >= 1 && /^(---|\.\.\.)\s*$/.test(line))
    if (close > 0) {
      for (; start <= close; start++) out.push(lines[start])
    } else {
      // Opens like front matter but never closes. micromark reads the keys as a
      // paragraph, so reflowing them would merge separate keys onto one line —
      // broken YAML the render check cannot see (no front-matter extension). Copy
      // the contiguous key block verbatim instead, up to the first blank line.
      for (; start < lines.length && lines[start].trim() !== ''; start++) out.push(lines[start])
    }
  }
  const body = lines.slice(start)
  const reflow = new Map(paragraphs(body.join('\n')).map((range) => [range[0], range]))
  for (let i = 0; i < body.length; ) {
    const range = reflow.get(i + 1) // paragraph line numbers are 1-based into body
    if (!range) {
      out.push(body[i])
      i++
      continue
    }
    out.push(...emit(body.slice(range[0] - 1, range[1])))
    i = range[1]
  }
  return out.join(eol)
}

/** The document as the reader sees it: insignificant whitespace collapsed. */
export const render = (markdown) =>
  micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })
    .split(/(<pre[\s\S]*?<\/pre>)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/\s+/g, ' ')))
    .join('')
