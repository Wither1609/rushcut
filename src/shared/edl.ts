import type { Edl, Range, Word } from './types'

export function normalizeKeep(keep: Range[], duration: number): Range[] {
  const sorted = keep
    .map((r) => ({ in: Math.max(0, r.in), out: Math.min(duration, r.out) }))
    .filter((r) => r.out - r.in > 0.04)
    .sort((a, b) => a.in - b.in)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.in <= last.out + 0.02) last.out = Math.max(last.out, r.out)
    else out.push({ ...r })
  }
  return out
}

/** Index of the keep range containing t, or -1. */
export function keepIndexAt(keep: Range[], t: number): number {
  let lo = 0
  let hi = keep.length - 1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (keep[m].out <= t) lo = m + 1
    else if (keep[m].in > t) hi = m - 1
    else return m
  }
  return -1
}

/** Next playable source time at or after t (skips removed ranges). Returns null at the end. */
export function nextPlayable(keep: Range[], t: number): number | null {
  if (keepIndexAt(keep, t) >= 0) return t
  for (const r of keep) if (r.in >= t) return r.in
  return null
}

export function editedDuration(keep: Range[]): number {
  return keep.reduce((a, r) => a + (r.out - r.in), 0)
}

/** Source time -> output time. Times inside a removed gap map to the next kept frame. */
export function srcToOut(keep: Range[], t: number): number {
  let acc = 0
  for (const r of keep) {
    if (t < r.in) return acc
    if (t < r.out) return acc + (t - r.in)
    acc += r.out - r.in
  }
  return acc
}

export function outToSrc(keep: Range[], o: number): number {
  let acc = 0
  for (const r of keep) {
    const len = r.out - r.in
    if (o < acc + len) return r.in + (o - acc)
    acc += len
  }
  return keep.length ? keep[keep.length - 1].out : 0
}

/** Remove [a,b] from keep. */
export function cutRange(keep: Range[], a: number, b: number): Range[] {
  const out: Range[] = []
  for (const r of keep) {
    if (b <= r.in || a >= r.out) out.push({ ...r })
    else {
      if (a > r.in) out.push({ in: r.in, out: a })
      if (b < r.out) out.push({ in: b, out: r.out })
    }
  }
  return out.filter((r) => r.out - r.in > 0.04)
}

/** Restore [a,b] into keep. */
export function restoreRange(keep: Range[], a: number, b: number, duration: number): Range[] {
  return normalizeKeep([...keep, { in: a, out: b }], duration)
}

/** Split the keep range at t (creates an edit point without removing anything). */
export function splitAt(keep: Range[], t: number): Range[] {
  const i = keepIndexAt(keep, t)
  if (i < 0) return keep
  const r = keep[i]
  if (t - r.in < 0.1 || r.out - t < 0.1) return keep
  return [...keep.slice(0, i), { in: r.in, out: t }, { in: t, out: r.out }, ...keep.slice(i + 1)]
}

export const PAD_IN = 0.08
export const PAD_OUT = 0.15

/**
 * Move every cut onto a word boundary. A word stays in a range when its middle is inside it;
 * each edge then lands in the gap next to the first/last kept word, with a little breathing room
 * when the gap allows it. Edges listed in `fixed` (already in the previous version) and edit
 * points between two touching ranges are left alone.
 */
export function snapKeep(keep: Range[], words: Word[], duration: number, fixed: number[] = []): Range[] {
  if (!words.length) return normalizeKeep(keep, duration)
  const isFixed = (x: number) => fixed.some((f) => Math.abs(f - x) < 1e-3)
  const mid = (w: Word) => (w.start + w.end) / 2
  const out = keep.map((r, k) => {
    const touchPrev = k > 0 && r.in - keep[k - 1].out <= 0.02
    const touchNext = k + 1 < keep.length && keep[k + 1].in - r.out <= 0.02
    let a = r.in
    if (!touchPrev && !isFixed(r.in)) {
      // n = first word whose middle is after the edge: it is the first word kept by this range, if any.
      let n = Math.max(0, wordAt(words, r.in))
      while (n < words.length && mid(words[n]) < r.in) n++
      const lo = n > 0 ? words[n - 1].end : 0
      const hi = n < words.length ? words[n].start : duration
      if (n < words.length && mid(words[n]) < r.out) {
        // An edge that fell inside the previous (dropped) word is pulled back to the usual margin.
        a = a < lo ? Math.max(lo, hi - PAD_IN) : Math.max(lo, Math.min(a, hi - PAD_IN))
      } else a = Math.min(Math.max(a, lo), hi) // no speech kept: just get out of any word
    }
    let b = r.out
    if (!touchNext && !isFixed(r.out)) {
      // m = last word whose middle is before the edge: the last word kept by this range, if any.
      let m = wordAt(words, r.out)
      while (m >= 0 && mid(words[m]) >= r.out) m--
      const lo = m >= 0 ? words[m].end : 0
      const hi = m + 1 < words.length ? words[m + 1].start : duration
      if (m >= 0 && mid(words[m]) >= r.in) {
        b = b > hi ? Math.min(hi, lo + PAD_OUT) : Math.min(hi, Math.max(b, lo + PAD_OUT))
      } else b = Math.max(Math.min(b, hi), lo)
    }
    return { in: a, out: b }
  })
  // Merge only what overlaps after snapping, so deliberate edit points (touching ranges) survive.
  const merged: Range[] = []
  for (const r of out) {
    const prev = merged[merged.length - 1]
    if (prev && r.in < prev.out - 1e-3) prev.out = Math.max(prev.out, r.out)
    else if (r.out - r.in > 0.04) merged.push(r)
  }
  return merged
}

/** Move graphics and zooms that start in a removed passage to the next kept frame; drop what no longer fits. */
export function fitToKeep<T extends { t: number; d: number }>(items: T[], keep: Range[], minD: number): T[] {
  const res: T[] = []
  for (const it of items) {
    const t = nextPlayable(keep, it.t)
    if (t === null) continue
    const d = it.d - (t - it.t)
    if (d > minD) res.push({ ...it, t, d })
  }
  return res
}

/** Binary search: index of the last word starting at or before t. */
export function wordAt(words: Word[], t: number): number {
  let lo = 0
  let hi = words.length - 1
  let r = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (words[m].start <= t) {
      r = m
      lo = m + 1
    } else hi = m - 1
  }
  return r
}

export function emptyEdl(duration: number, version: string, designSystem: string): Edl {
  return {
    version,
    parent: null,
    createdAt: new Date().toISOString(),
    status: 'review',
    origin: 'manual',
    designSystem,
    summary: 'Montage brut, rien de coupé.',
    keep: [{ in: 0, out: duration }],
    chapters: [],
    zooms: [],
    gfx: [],
    captions: { enabled: true, maxWords: 3, uppercase: true },
    resolves: []
  }
}

export function tc(x: number, fps = 25): string {
  x = Math.max(0, x)
  const h = Math.floor(x / 3600)
  const m = Math.floor((x % 3600) / 60)
  const s = Math.floor(x % 60)
  const f = Math.floor((x % 1) * fps)
  const p = (v: number) => String(v).padStart(2, '0')
  return (h ? p(h) + ':' : '') + `${p(m)}:${p(s)}:${p(f)}`
}

export function shortTime(x: number): string {
  const m = Math.floor(x / 60)
  const s = Math.floor(x % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
