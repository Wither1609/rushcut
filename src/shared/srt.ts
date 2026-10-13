// SubRip subtitles of the edited video, for YouTube, LinkedIn or any player that reads .srt.
// Lines are longer than the burned-in captions (which show 2–3 words at a time): a reader needs whole phrases.
import { buildChunks, chunksToOut } from './overlay'
import type { Range, Word } from './types'

const MAX_WORDS = 7
const MAX_LINE = 42

function stamp(x: number): string {
  const ms = Math.max(0, Math.round(x * 1000))
  const p = (v: number, n = 2) => String(v).padStart(n, '0')
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

/** Break a cue in two lines of similar length when it is too long for one. */
function wrap(text: string): string {
  if (text.length <= MAX_LINE) return text
  const words = text.split(' ')
  let best = 1
  let bestDiff = Infinity
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length)
    if (diff < bestDiff) {
      best = i
      bestDiff = diff
    }
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`
}

export function buildSrt(words: Word[], keep: Range[]): string {
  const cues = chunksToOut(buildChunks(words, keep, MAX_WORDS), keep).filter((c) => c.end - c.start > 0.05)
  return cues
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${wrap(c.words.map((w) => w.text).join(' '))}\n`)
    .join('\n')
}
