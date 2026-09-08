/**
 * Sentence splitting and line markup, shared by the lint rule and the formatter.
 *
 * They must agree to the character: the rule reads a single output line, the
 * formatter reads the whole joined block, and `sentence-splitter` is
 * context-sensitive — so any divergence in how they call it shows up as the
 * formatter emitting a line the rule then rejects. Sharing one splitter and one
 * markup grammar is what keeps them in lockstep.
 *
 * The lockstep is on FORMATTER OUTPUT: the formatter never breaks a sentence
 * boundary that a joined line would re-split, so the rule accepts what it emits.
 * On hand-written input the rule is deliberately stricter — an emphasis span that
 * opens on one line and closes on another is unclosed on either line alone, so
 * this function cannot see it there and the rule still flags a mid-line end.
 */
import { parse, postprocess, preprocess } from 'micromark'
import { DefaultAbbrMarkerOptions, split as splitSentences } from 'sentence-splitter'

/**
 * Blockquote markers and list bullets: markup, not the sentence. One definition
 * so the rule and the formatter carve markup from prose the same way.
 */
export const LEADING_MARKUP = /^(\s*(?:>\s*)*)((?:[-*+]|\d+[.)])\s+)?/

/**
 * Punctuation that closes a clause and so must never open a line: SEMBR001
 * rejects a line that opens on one of these, and the formatter glues them back
 * so it never emits such a line. One definition keeps the two in step.
 */
export const ORPHAN_PUNCTUATION = ':;!?»,)'

/**
 * Extra abbreviations, added on top of `sentence-splitter`'s built-in English
 * list so a default configuration handles French prose too — these are the stops
 * French writes mid-sentence; the rest of the tool is language-agnostic. Both the
 * rule and the formatter start from this list, so the defaults keep them in step;
 * the rule's `abbreviations` config adds more (exposing these as an option is a
 * possible future feature). The bin (`sembr-format`) has no config, so a new
 * abbreviation the corpus needs belongs HERE, or the formatter falls out of step
 * with the rule.
 */
export const DEFAULT_ABBREVIATIONS = ['p.', 'ex.', 'cf.', 'réf.', 'env.', 'M.', 'Mme', 'éd.']

/** `sentence-splitter` options with `abbreviations` folded into its own list. */
function abbrOptions(abbreviations) {
  return {
    AbbrMarker: {
      language: {
        ...DefaultAbbrMarkerOptions.language,
        ABBREVIATIONS: [...DefaultAbbrMarkerOptions.language.ABBREVIATIONS, ...abbreviations],
      },
    },
  }
}

/**
 * The character before an abbreviation, for it to count as one: a word boundary.
 * `\s` already matches the non-breaking and thin spaces French sets around its
 * punctuation, so nothing more is needed.
 */
const WORD_BOUNDARY = /[\s(«"']/

/**
 * Does `text` end with a known abbreviation on a word boundary? `sentence-splitter`
 * ends a sentence at `cf. ADR-0065` — it cannot tell a proper noun from a fresh
 * sentence — and a known abbreviation stitches the fragments back. It consults only
 * the passed list, not `sentence-splitter`'s own English defaults, so an English
 * look-alike (`Al.`, `No.`, `Co.`, `St.`) does not silently swallow a real sentence
 * break; and `0.2.0.`, in no list, still splits.
 */
function endsWithAbbreviation(text, abbreviations) {
  const trimmed = text.trimEnd()
  return abbreviations.some((abbr) => {
    if (!trimmed.endsWith(abbr)) return false
    const before = trimmed[trimmed.length - abbr.length - 1]
    return before === undefined || WORD_BOUNDARY.test(before)
  })
}

/**
 * The `[start, end)` offsets of every emphasis and strong span in `text`, read
 * from micromark's own event stream — the parser the lint rule already binds to.
 * A real parse, not a delimiter count: `5 * 3` carries no span, `*Attention*`
 * one, and `config_prod` is a word, not an underscore emphasis.
 */
export function emphasisSpans(text) {
  // A leading run of 4+ spaces reads as an indented code block and would hide the
  // emphasis; a wrapped list continuation arrives indented, so parse from the
  // first non-space and shift the offsets back onto the original text.
  const indent = text.length - text.trimStart().length
  const written = parse()
    .document()
    .write(preprocess()(text.slice(indent), undefined, true))
  const events = postprocess(written)
  const spans = []
  for (const [kind, token] of events) {
    if (kind === 'enter' && (token.type === 'emphasis' || token.type === 'strong')) {
      spans.push([token.start.offset + indent, token.end.offset + indent])
    }
  }
  // Outermost only: an emphasis nested in a strong is carried inside its atom.
  const encloses = (o, s, e) => o[0] <= s && o[1] >= e && (o[0] < s || o[1] > e)
  return spans.filter((span) => !spans.some((other) => encloses(other, span[0], span[1])))
}

/**
 * A fragment that opens on punctuation SEMBR001 would call orphaned — a closer
 * `) ] »` or a clitic `: ; , ! ?` — belongs to the previous sentence: the mark sat
 * inside the parenthetical/quotation or after it (`« … ».`, `« … » !`, `(…) ;`).
 * French sets a space before `! ? ; :`, so the run tolerates spaces between marks.
 * Opening quotes are left out (`"Bonjour"` and `« … »` OPEN a fragment); `» La`,
 * with no mark after the space, keeps just the `»`.
 */
const CLOSER = new RegExp(
  `^([${ORPHAN_PUNCTUATION}\\]](?:\\s*[${ORPHAN_PUNCTUATION}\\].…])*)(\\s*)`,
)

/**
 * The sentences of `text`, with three seams stitched so a line the formatter
 * emits is a line the rule accepts:
 *   - a split after a known abbreviation (`extra` adds to {@link DEFAULT_ABBREVIATIONS});
 *   - a split that falls inside an emphasis or strong span;
 *   - a closer or clitic (`) ] » : ; , ! ?`) pulled back onto the sentence before it;
 *   - a standalone punctuation node folded onto the sentence before it.
 *
 * Each node keeps `sentence-splitter`'s shape — `type`, `raw`, and a `range`
 * addressing `text` — so a merged sentence reads exactly as an original.
 */
export function sentencesOf(text, extra = []) {
  const known = [...DEFAULT_ABBREVIATIONS, ...extra]
  const spans = emphasisSpans(text)
  const straddles = (end, start) => spans.some(([s, e]) => s < start && e > end)
  const push = (start, end) =>
    merged.push({ type: 'Sentence', raw: text.slice(start, end), range: [start, end] })
  const extend = (previous, end) => {
    previous.range = [previous.range[0], end]
    previous.raw = text.slice(previous.range[0], end)
  }
  const merged = []
  for (const node of splitSentences(text, abbrOptions(known))) {
    if (node.type !== 'Sentence') {
      // Whitespace between sentences is the line break to come, dropped safely.
      // But `sentence-splitter` also emits a lone `!`/`?` between sentences as a
      // standalone node — not whitespace, and dropping it would lose the mark
      // from the output. Fold it onto the previous sentence (SEMBR001 says orphan
      // punctuation belongs to the line before), whitespace in the gap included.
      const previous = merged[merged.length - 1]
      if (previous && node.raw.trim() !== '') extend(previous, node.range[1])
      continue
    }
    const previous = merged[merged.length - 1]
    if (
      previous &&
      (endsWithAbbreviation(previous.raw, known) || straddles(previous.range[1], node.range[0]))
    ) {
      extend(previous, node.range[1])
      continue
    }
    const closer = previous && CLOSER.exec(node.raw)
    if (closer) {
      extend(previous, node.range[0] + closer[1].length)
      const rest = node.range[0] + closer[0].length
      if (rest < node.range[1]) push(rest, node.range[1])
      continue
    }
    push(node.range[0], node.range[1])
  }
  return merged
}

/**
 * The mid-line sentence ends in `masked`: one `{ end, gap }` per place a sentence
 * closes and another follows on the same line — `end` the offset just past it,
 * `gap` the whitespace before the next. This is the boundary SEMBR003 reports and
 * the one the formatter's self-check refuses to emit; sharing it keeps the rule
 * and the formatter reading a mid-line end the same way, by construction.
 */
export function midLineEnds(masked, extra = []) {
  const ends = []
  const sentences = sentencesOf(masked, extra)
  for (const sentence of sentences.slice(0, -1)) {
    const end = sentence.range[1]
    const gap = /^\s+/.exec(masked.slice(end))?.[0] ?? ''
    if (gap !== '' && masked.slice(end + gap.length).trim() !== '') ends.push({ end, gap })
  }
  return ends
}
