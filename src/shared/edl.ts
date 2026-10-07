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
