// Correcting what the transcription heard. Only the text changes: timings stay those of the audio,
// so cuts, captions and the SRT stay in sync. Pure functions, shared by the editor and its checks.
import type { Word } from './types'

/** Leading punctuation, the word itself, trailing punctuation: "«Bonjour," → ["«", "Bonjour", ","]. */
function parts(text: string): [string, string, string] {
  const m = text.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u)
  return m ? [m[1], m[2], m[3]] : ['', text, '']
}

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('fr')

/**
 * Replace the text of words[i]. Several words typed in place of one share its time span, in proportion
 * to their length (the next caption word lights up at about the right moment). An empty text removes
 * the word from the transcript, for merging "auto mobile" into one word; the audio is not cut.
 */
export function editWord(words: Word[], i: number, text: string): Word[] {
  const w = words[i]
  if (!w) return words
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 1 && tokens[0] === w.text) return words
  return [...words.slice(0, i), ...spread(w, tokens), ...words.slice(i + 1)]
}

function spread(w: Word, tokens: string[]): Word[] {
  if (tokens.length <= 1) return tokens.map((text) => ({ ...w, text }))
  const total = tokens.reduce((a, t) => a + t.length, 0)
  const span = w.end - w.start
  let at = w.start
  return tokens.map((text, k) => {
    const start = at
    at = k === tokens.length - 1 ? w.end : at + (span * text.length) / total
    return { text, start, end: at }
  })
}

/** Whether a word is the one searched for, ignoring case and the punctuation around it. */
export function wordMatches(text: string, query: string): boolean {
  const q = norm(query.trim())
  return !!q && norm(parts(text)[1]) === q
}

/** Indexes of the words matching the query. */
export function findWord(words: Word[], query: string): number[] {
  const out: number[] = []
  words.forEach((w, i) => wordMatches(w.text, query) && out.push(i))
  return out
}

/** Replace every occurrence of one word, keeping the punctuation around each one. */
export function replaceWord(words: Word[], query: string, replacement: string): { words: Word[]; count: number } {
  const repl = replacement.trim()
  let count = 0
  const out: Word[] = []
  for (const w of words) {
    if (!wordMatches(w.text, query)) {
      out.push(w)
      continue
    }
    count++
    const [lead, , trail] = parts(w.text)
    const tokens = repl.split(/\s+/).filter(Boolean)
    if (!tokens.length) continue
    tokens[0] = lead + tokens[0]
    tokens[tokens.length - 1] += trail
    out.push(...spread(w, tokens))
  }
  return { words: count ? out : words, count }
}
