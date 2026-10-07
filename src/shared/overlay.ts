// Timing of everything drawn on top of the video (motion design + captions).
// Shared by the live preview (source time) and the exporter (output time), so both show the same thing.
import { keepIndexAt, srcToOut } from './edl'
import type { GfxItem, Range, Word } from './types'

export interface CaptionChunk {
  start: number
  end: number
  words: Word[]
}

export const GFX_IN = 0.45
export const GFX_OUT = 0.35
export const LIST_STAGGER = 0.55

/** Seconds after its start when a graphic stops moving. */
export function gfxSettle(g: GfxItem): number {
  return GFX_IN + (g.comp === 'list' ? Math.max(0, (g.props.items?.length ?? 1) - 1) * LIST_STAGGER : 0)
}

/** Word groups for captions, in source time. Removed words are skipped. */
export function buildChunks(words: Word[], keep: Range[], maxWords: number): CaptionChunk[] {
  const chunks: CaptionChunk[] = []
  let cur: Word[] = []
  let curKeep = -1
  const flush = () => {
    if (cur.length) chunks.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur })
    cur = []
  }
  for (const w of words) {
    const k = keepIndexAt(keep, (w.start + w.end) / 2)
    if (k < 0) {
      flush()
      continue
    }
    const prev = cur[cur.length - 1]
    if (prev && (k !== curKeep || w.start - prev.end > 0.6)) flush()
    curKeep = k
    cur.push(w)
    if (cur.length >= maxWords || /[.?!:;,…]$/.test(w.text)) flush()
  }
  flush()
  // Hold each group a little after its last word, without overlapping the next one.
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1]
    chunks[i].end = Math.min(chunks[i].end + 0.25, next ? next.start : Infinity)
  }
  return chunks
}

export function chunksToOut(chunks: CaptionChunk[], keep: Range[]): CaptionChunk[] {
  return chunks.map((c) => ({
    start: srcToOut(keep, c.start),
    end: srcToOut(keep, c.end),
    words: c.words.map((w) => ({ text: w.text, start: srcToOut(keep, w.start), end: srcToOut(keep, w.end) }))
  }))
}

export function gfxToOut(gfx: GfxItem[], keep: Range[]): GfxItem[] {
  return gfx
    .map((g) => {
      const t = srcToOut(keep, g.t)
      return { ...g, t, d: srcToOut(keep, g.t + g.d) - t }
    })
    .filter((g) => g.d > 0.3)
}

/**
 * The only instants where the overlay changes. Holds are captured once, animations at `fps`.
 * A 60 s talking-head video typically needs a few hundred captures instead of 1 800.
 */
export function sampleTimes(gfx: GfxItem[], chunks: CaptionChunk[], total: number, fps: number): number[] {
  const set = new Set<number>()
  const add = (t: number) => {
    if (t >= 0 && t < total) set.add(Math.round(t * fps))
  }
  const sweep = (a: number, b: number) => {
    for (let t = a; t < b; t += 1 / fps) add(t)
    add(b)
  }
  add(0)
  for (const g of gfx) {
    const e = g.t + g.d
    sweep(g.t, g.t + gfxSettle(g))
    sweep(e - GFX_OUT, e)
  }
  for (const c of chunks) {
    add(c.start)
    for (const w of c.words) add(w.start)
    add(c.end)
  }
  return [...set].sort((a, b) => a - b).map((f) => f / fps)
}
