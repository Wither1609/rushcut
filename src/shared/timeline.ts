// Direct manipulation on the timeline: trimming clips, moving and resizing graphics, zooms and chapters.
// Pure functions on source times, so the drag preview and the committed edit are computed the same way.
import { PAD_IN, PAD_OUT } from './edl'
import type { Range, Word } from './types'

/** Shortest clip a trim can leave. */
export const MIN_CLIP = 0.1

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const touching = (a: Range, b: Range) => b.in - a.out <= 0.02

/**
 * Move one edge of keep[i] to t. A free edge stops at the neighbouring clip, so dragging it outwards brings
 * back removed material. An edge shared with a touching neighbour (an edit point made with C) rolls:
 * both clips move together and nothing is added or removed.
 */
export function trimClip(keep: Range[], i: number, edge: 'in' | 'out', t: number, duration: number): Range[] {
  const out = keep.map((r) => ({ ...r }))
  const r = out[i]
  if (!r) return keep
  if (edge === 'in') {
    const prev = out[i - 1]
    if (prev && touching(prev, r)) {
      r.in = prev.out = clamp(t, prev.in + MIN_CLIP, r.out - MIN_CLIP)
    } else r.in = clamp(t, prev ? prev.out : 0, r.out - MIN_CLIP)
  } else {
    const next = out[i + 1]
    if (next && touching(r, next)) {
      r.out = next.in = clamp(t, r.in + MIN_CLIP, next.out - MIN_CLIP)
    } else r.out = clamp(t, r.in + MIN_CLIP, next ? next.in : duration)
  }
  return out
}

export type SpanMode = 'move' | 'in' | 'out'

/** New start and duration of a graphic or zoom dragged by dt seconds, kept inside the video and above minD. */
export function moveSpan(t0: number, d0: number, mode: SpanMode, dt: number, duration: number, minD: number, maxD = Infinity) {
  if (mode === 'move') return { t: clamp(t0 + dt, 0, Math.max(0, duration - d0)), d: d0 }
  if (mode === 'in') {
    const end = t0 + d0
    const t = clamp(t0 + dt, Math.max(0, end - maxD), end - minD)
    return { t, d: end - t }
  }
  return { t: t0, d: clamp(d0 + dt, minD, Math.min(maxD, duration - t0)) }
}

/** The nearest candidate within tol seconds, or x itself. */
export function snapTime(x: number, candidates: number[], tol: number): { t: number; snapped: boolean } {
  let best = x
  let dist = tol
  for (const c of candidates) {
    const d = Math.abs(c - x)
    if (d < dist) {
      dist = d
      best = c
    }
  }
  return { t: best, snapped: best !== x }
}

/**
 * Where a dragged edge likes to land: the playhead, the other clip edges and the gaps between words.
 * A clip start snaps just before a word, a clip end just after one, like the cuts Claude makes.
 */
export function snapCandidates(words: Word[], keep: Range[], playhead: number, edge: 'in' | 'out' | 'any'): number[] {
  const c = [playhead]
  for (const r of keep) c.push(r.in, r.out)
  for (const w of words) {
    if (edge !== 'out') c.push(edge === 'in' ? w.start - PAD_IN : w.start)
    if (edge === 'out') c.push(w.end + PAD_OUT)
  }
  return c
}
