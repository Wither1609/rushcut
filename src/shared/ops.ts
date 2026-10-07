// A new version is a list of edits applied to the previous one, so anything the review did not
// mention stays byte-for-byte identical. Claude writes these ops; the app applies and validates them.
import { cutRange, fitToKeep, restoreRange, snapKeep } from './edl'
import type { Chapter, Edl, GfxComp, GfxItem, Word, Zoom } from './types'

export interface GfxFields {
  t: number
  d: number
  comp: GfxComp
  title: string
  subtitle: string
  text: string
  items: string[]
  /** image comp: file name of one of the project's illustrations. */
  image: string
  layout: 'card' | 'full'
}

export type EdlOp =
  | { op: 'cut'; a: number; b: number }
  | { op: 'restore'; a: number; b: number }
  | ({ op: 'gfx_add' } & GfxFields)
  | ({ op: 'gfx_update'; ref: string } & GfxFields)
  | { op: 'gfx_remove'; ref: string }
  | { op: 'zoom_add'; t: number; d: number; scale: number }
  | { op: 'zoom_update'; ref: string; t: number; d: number; scale: number }
  | { op: 'zoom_remove'; ref: string }
  | { op: 'chapter_add'; t: number; title: string }
  | { op: 'chapter_update'; ref: string; t: number; title: string }
  | { op: 'chapter_remove'; ref: string }
  | { op: 'captions'; enabled: boolean; maxWords: number; uppercase: boolean }

/** Stable references Claude uses to point at existing items: gfx keep their id, zooms and chapters get z0…, c0…. */
export const zoomRef = (i: number) => `z${i}`
export const chapterRef = (i: number) => `c${i}`

const clampZoom = (z: Zoom): Zoom => ({ t: z.t, d: Math.min(z.d, 8), scale: Math.min(1.35, Math.max(1.02, z.scale)) })
const gfxProps = (g: GfxFields): GfxItem['props'] => ({
  title: g.title,
  subtitle: g.subtitle,
  text: g.text,
  items: g.items.filter(Boolean).slice(0, 6),
  ...(g.comp === 'image' ? { src: g.image, layout: g.layout } : {})
})

export interface OpsResult {
  edl: Omit<Edl, 'version' | 'parent' | 'createdAt' | 'status' | 'origin' | 'summary' | 'resolves'>
  applied: number
  /** Human-readable reasons for ops that were skipped. */
  skipped: string[]
}

export function applyOps(base: Edl, ops: EdlOp[], words: Word[], duration: number, images: string[] = []): OpsResult {
  let keep = base.keep.map((r) => ({ ...r }))
  // Items carry their original ref so that ops keep pointing at the right thing after earlier removals.
  let gfx = base.gfx.map((g) => ({ ...g, props: { ...g.props } }))
  let zooms = base.zooms.map((z, i) => ({ ref: zoomRef(i), z: { ...z } }))
  let chapters = base.chapters.map((c, i) => ({ ref: chapterRef(i), c: { ...c } }))
  let captions = { ...base.captions }
  const skipped: string[] = []
  let applied = 0
  let n = 0
  const newId = () => `g${Date.now().toString(36)}o${n++}`
  const inRange = (t: number) => Number.isFinite(t) && t >= 0 && t < duration

  for (const o of ops) {
    const miss = (ref: string) => skipped.push(`${o.op} : référence ${ref} introuvable`)
    if ((o.op === 'gfx_add' || o.op === 'gfx_update') && o.comp === 'image' && !images.includes(o.image)) {
      skipped.push(`${o.op} : image « ${o.image} » absente du projet`)
      continue
    }
    switch (o.op) {
      case 'cut':
      case 'restore': {
        const a = Math.max(0, Math.min(o.a, o.b))
        const b = Math.min(duration, Math.max(o.a, o.b))
        if (!(b - a > 0.04)) {
          skipped.push(`${o.op} ${o.a}–${o.b} : plage vide`)
          continue
        }
        keep = o.op === 'cut' ? cutRange(keep, a, b) : restoreRange(keep, a, b, duration)
        break
      }
      case 'gfx_add':
        if (!inRange(o.t) || o.d <= 0.5) {
          skipped.push(`gfx_add à ${o.t} : hors de la vidéo`)
          continue
        }
        gfx.push({ id: newId(), t: o.t, d: Math.min(o.d, 12), comp: o.comp, props: gfxProps(o) })
        break
      case 'gfx_update': {
        const g = gfx.find((g) => g.id === o.ref)
        if (!g) {
          miss(o.ref)
          continue
        }
        // Merge, so fields Claude does not see (image file, layout…) are kept.
        Object.assign(g, { t: inRange(o.t) ? o.t : g.t, d: o.d > 0.5 ? Math.min(o.d, 12) : g.d, comp: o.comp, props: { ...g.props, ...gfxProps(o) } })
        break
      }
      case 'gfx_remove': {
        const before = gfx.length
        gfx = gfx.filter((g) => g.id !== o.ref)
        if (gfx.length === before) {
          miss(o.ref)
          continue
        }
        break
      }
      case 'zoom_add':
        if (!inRange(o.t) || o.d <= 0.3) {
          skipped.push(`zoom_add à ${o.t} : hors de la vidéo`)
          continue
        }
        zooms.push({ ref: '', z: clampZoom(o) })
        break
      case 'zoom_update': {
        const z = zooms.find((z) => z.ref === o.ref)
        if (!z) {
          miss(o.ref)
          continue
        }
        z.z = clampZoom({ t: inRange(o.t) ? o.t : z.z.t, d: o.d > 0.3 ? o.d : z.z.d, scale: o.scale })
        break
      }
      case 'zoom_remove': {
        const before = zooms.length
        zooms = zooms.filter((z) => z.ref !== o.ref)
        if (zooms.length === before) {
          miss(o.ref)
          continue
        }
        break
      }
      case 'chapter_add':
        if (!inRange(o.t)) {
          skipped.push(`chapter_add à ${o.t} : hors de la vidéo`)
          continue
        }
        chapters.push({ ref: '', c: { t: o.t, title: o.title } })
        break
      case 'chapter_update': {
        const c = chapters.find((c) => c.ref === o.ref)
        if (!c) {
          miss(o.ref)
          continue
        }
        c.c = { t: inRange(o.t) ? o.t : c.c.t, title: o.title }
        break
      }
      case 'chapter_remove': {
        const before = chapters.length
        chapters = chapters.filter((c) => c.ref !== o.ref)
        if (chapters.length === before) {
          miss(o.ref)
          continue
        }
        break
      }
      case 'captions':
        captions = { ...captions, enabled: o.enabled, maxWords: Math.min(8, Math.max(1, Math.round(o.maxWords))), uppercase: o.uppercase }
        break
    }
    applied++
  }

  // New cut points land on word boundaries; edges the previous version already had are not touched.
  const fixed = base.keep.flatMap((r) => [r.in, r.out])
  keep = snapKeep(keep, words, duration, fixed)
  if (!keep.length) keep = [{ in: 0, out: duration }]

  return {
    edl: {
      designSystem: base.designSystem,
      keep,
      chapters: chapters.map((c) => c.c).sort((a, b) => a.t - b.t) as Chapter[],
      zooms: fitToKeep(zooms.map((z) => z.z), keep, 0.3).sort((a, b) => a.t - b.t),
      gfx: fitToKeep(gfx, keep, 0.5).sort((a, b) => a.t - b.t),
      captions
    },
    applied,
    skipped
  }
}
