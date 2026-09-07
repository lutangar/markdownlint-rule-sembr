/**
 * Line-break rules for Markdown sources, in support of semantic line breaks.
 *
 * What we want is a break at a boundary of meaning (https://sembr.org). No tool
 * decides where that boundary is — these rules check the things around it that
 * a machine *can* decide: a line that never broke, a break that stranded
 * punctuation, a break that split something inline, and the French spacing that
 * makes a break impossible in the first place.
 *
 * Plain `.mjs` on purpose: markdownlint loads the module directly, so a rule
 * that needed a build step would make linting depend on compiling.
 *
 * `parser: 'none'` — these are line-level checks, so the token stream would cost
 * more than it gives. What it does mean is that code has to be skipped by hand:
 * `scan` below drops fenced blocks and table rows, and masks inline spans, link
 * destinations and autolinks so their contents never reach a rule.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const TABLE_ROW = /^\s{0,3}\|/
/** Leading blockquote markers and list bullets, which are not prose. */
const LEADING_MARKUP = /^(\s*(?:>\s*)*)((?:[-*+]|\d+[.)])\s+)?/

/**
 * Blank out what is not prose, keeping the offsets so a column number still
 * points at the right character: inline code, link destinations, autolinks and
 * escaped characters.
 */
function mask(line) {
  return line
    .replace(/\\./g, '••')
    .replace(/`[^`]*`/g, (m) => '•'.repeat(m.length))
    .replace(/\]\([^)]*\)/g, (m) => '•'.repeat(m.length))
    .replace(/<[^>\s]*>/g, (m) => '•'.repeat(m.length))
}

/** Walk the prose lines of a document, masked, skipping code and tables. */
function scan(params, visit) {
  let fence = null
  params.lines.forEach((line, index) => {
    const fenceMatch = FENCE.exec(line)
    if (fence !== null) {
      if (fenceMatch?.[1].startsWith(fence)) fence = null
      return
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      return
    }
    if (TABLE_ROW.test(line)) return
    if (line.trim() === '') return
    visit(line, mask(line), index + 1)
  })
}

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set([
  'cf',
  'etc',
  'vs',
  'al',
  'resp',
  'approx',
  'fig',
  'no',
  'nos',
  'p',
  'pp',
  'ca',
  'Dr',
  'Mr',
  'Mrs',
  'Ms',
  'Prof',
  'St',
  'M',
  'Mme',
  'Mlle',
  'MM',
  'éd',
  'env',
])

const orphanPunctuation = {
  names: ['SEMBR001', 'sembr-orphan-punctuation'],
  description: 'Line starts with punctuation that belongs to the previous line',
  tags: ['whitespace', 'sembr'],
  parser: 'none',
  function: (params, onError) => {
    scan(params, (line, masked, lineNumber) => {
      const prefix = LEADING_MARKUP.exec(masked)?.[0].length ?? 0
      const char = masked[prefix]
      if (char && ':;!?»,)'.includes(char) && !(char === '!' && masked[prefix + 1] === '[')) {
        onError({
          lineNumber,
          detail: `The line opens on "${line.trim()[0]}", so the break came one character too early`,
          context: line.trim().slice(0, 40),
        })
      }
    })
  },
}

const nonBreakingSpace = {
  names: ['SEMBR002', 'sembr-non-breaking-space'],
  description: 'Ordinary space where French typography requires a non-breaking one',
  tags: ['whitespace', 'sembr'],
  parser: 'none',
  function: (params, onError) => {
    scan(params, (line, masked, lineNumber) => {
      // A space before these is wrong in English (it never occurs) and wrong in
      // French (it must not break), so one rule serves both languages.
      for (const match of masked.matchAll(/ ([;:!?%»])/g)) {
        if (match[1] === '!' && masked[match.index + 2] === '[') continue
        // Thin for the tall punctuation, ordinary width for the rest — the two
        // spaces French typography actually distinguishes.
        const space = ';!?%'.includes(match[1]) ? '\u202f' : '\u00a0'
        onError({
          lineNumber,
          detail: `An ordinary space precedes "${match[1]}": use U+00A0 (: ») or U+202F (; ! ? %)`,
          context: line.slice(Math.max(0, match.index - 20), match.index + 20).trim(),
          // Masking preserves offsets, so a column read from the masked line
          // addresses the same character in the source.
          fixInfo: { editColumn: match.index + 1, deleteCount: 1, insertText: space },
        })
      }
      for (const match of masked.matchAll(/« /g)) {
        onError({
          lineNumber,
          detail: 'An ordinary space follows "«": use U+00A0',
          context: line.slice(Math.max(0, match.index - 10), match.index + 30).trim(),
          fixInfo: { editColumn: match.index + 2, deleteCount: 1, insertText: '\u00a0' },
        })
      }
    })
  },
}

const oneSentencePerLine = {
  names: ['SEMBR003', 'sembr-one-sentence-per-line'],
  description: 'A sentence ends mid-line: start the next one on its own line',
  tags: ['sembr'],
  parser: 'none',
  function: (params, onError) => {
    scan(params, (line, masked, lineNumber) => {
      for (const match of masked.matchAll(/([^\s.]*)([.!?])(["'»)\]]*)\s+(?=\S)/g)) {
        const [, word, stop] = match
        if (stop === '.') {
          // A single letter is an initial or e.g./i.e.; digits are a version or
          // a decimal; the rest is the abbreviation list.
          if (word.length <= 1 || /\d$/.test(word) || ABBREVIATIONS.has(word)) continue
        }
        onError({
          lineNumber,
          detail: 'The sentence ends here — the next one starts a new line',
          context: line.slice(Math.max(0, match.index - 25), match.index + 15).trim(),
        })
      }
    })
  },
}

const splitInlineSpan = {
  names: ['SEMBR004', 'sembr-split-inline-span'],
  description: 'A code span is split across lines',
  tags: ['code', 'sembr'],
  parser: 'none',
  function: (params, onError) => {
    scan(params, (line, _masked, lineNumber) => {
      const backticks = (line.replace(/\\`/g, '').match(/`/g) ?? []).length
      if (backticks % 2 === 1) {
        onError({
          lineNumber,
          detail: 'Odd number of backticks: the code span continues on the next line',
          context: line.trim().slice(0, 40),
        })
      }
    })
  },
}

export default [orphanPunctuation, nonBreakingSpace, oneSentencePerLine, splitInlineSpan]
