import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clock } from '../clock'
import { mediaUrl } from '../api'
import { keepIndexAt, shortTime } from '../../../shared/edl'
import { moveSpan, snapCandidates, snapTime, trimClip, type SpanMode } from '../../../shared/timeline'
import { PEAKS_PER_SEC, type Chapter, type Comment, type Edl, type GfxItem, type Project, type Range, type Word, type Zoom } from '../../../shared/types'

export type Selection =
  | { kind: 'clip'; index: number }
  | { kind: 'gap'; a: number; b: number }
  | { kind: 'gfx'; id: string }
  | { kind: 'zoom'; index: number }
  | { kind: 'chapter'; index: number }
  | { kind: 'words'; a: number; b: number }
  | null

export type TimelinePatch = Partial<Pick<Edl, 'keep' | 'gfx' | 'zooms' | 'chapters'>>

/** What is being dragged, with the values it had when the drag started. */
type DragTarget =
  | { kind: 'clip'; index: number; edge: 'in' | 'out' }
  | { kind: 'gfx'; id: string; mode: SpanMode; t0: number; d0: number }
  | { kind: 'zoom'; index: number; mode: SpanMode; t0: number; d0: number }
  | { kind: 'chapter'; index: number; t0: number }
type Drag = DragTarget & { x0: number; moved: boolean; cands: number[] }

/** Snap distance, in screen pixels. */
const SNAP_PX = 8
/** Movement under this many pixels is a click, not a drag. */
const DRAG_PX = 3

interface Props {
  project: Project
  keep: Range[]
  gfx: GfxItem[]
  zooms: Zoom[]
  chapters: Chapter[]
  words: Word[]
  comments: Comment[]
  peaks: number[]
  pps: number
  setPps: (v: number) => void
  selection: Selection
  onSelect: (s: Selection) => void
  /** A finished drag: the edited lists, and what to select afterwards (lists may have been re-sorted). */
  onEdit: (patch: TimelinePatch, select: Selection) => void
}

const LABEL_W = 64
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200]

export function Timeline(p: Props) {
  const { project, pps } = p
  const D = project.media.duration
  // While dragging, the timeline draws the edited lists; the edit is committed once, on release.
  const [preview, setPreview] = useState<TimelinePatch | null>(null)
  const [guide, setGuide] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const keep = preview?.keep ?? p.keep
  const gfxList = preview?.gfx ?? p.gfx
  const zooms = preview?.zooms ?? p.zooms
  const chapters = preview?.chapters ?? p.chapters
  const scroll = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const wave = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState({ x: 0, w: 800 })
  const width = Math.max(D * pps, view.w)

  useLayoutEffect(() => {
    const el = scroll.current!
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, w: el.clientWidth })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Removed ranges are the complement of keep.
  const gaps = useMemo(() => {
    const g: Range[] = []
    let last = 0
    for (const r of keep) {
      if (r.in - last > 0.02) g.push({ in: last, out: r.in })
      last = r.out
    }
    if (D - last > 0.02) g.push({ in: last, out: D })
    return g
  }, [keep, D])

  // ---- playhead (imperative) ----
  useEffect(() => {
    const update = (t: number) => {
      const x = t * pps
      if (head.current) head.current.style.transform = `translateX(${x}px)`
      const el = scroll.current
      if (el && clock.playing && (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft)) el.scrollLeft = x - 80
    }
    update(clock.t)
    return clock.subscribe(update)
  }, [pps])

  // ---- waveform: only the visible slice is drawn ----
  useEffect(() => {
    const c = wave.current
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const H = 50
    c.width = view.w * dpr
    c.height = H * dpr
    c.style.width = view.w + 'px'
    c.style.height = H + 'px'
    c.style.transform = `translateX(${view.x}px)`
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, view.w, H)
    const pk = p.peaks
    if (!pk.length) return
    for (let x = 0; x < view.w; x += 2) {
      const t0 = (view.x + x) / pps
      if (t0 > D) break
      const a = Math.floor(t0 * PEAKS_PER_SEC)
      const b = Math.max(a + 1, Math.floor(((view.x + x + 2) / pps) * PEAKS_PER_SEC))
      let m = 0
      for (let i = a; i < b && i < pk.length; i++) if (pk[i] > m) m = pk[i]
      const h = Math.max(1, (m / 255) * (H - 6))
      ctx.fillStyle = keepIndexAt(keep, t0) >= 0 ? '#c9bfb3' : '#4a4038'
      ctx.fillRect(x, (H - h) / 2, 1.5, h)
    }
  }, [view, pps, p.peaks, keep, D])

  // ---- ticks ----
  const major = STEPS.find((s) => s * pps >= 80) ?? 1200
  const minor = major / 5
  const ticks: { t: number; big: boolean }[] = []
  for (let i = Math.max(0, Math.floor(view.x / pps / minor)); i * minor <= Math.min(D, (view.x + view.w) / pps); i++) {
    ticks.push({ t: Math.round(i * minor * 1000) / 1000, big: i % 5 === 0 })
  }

  // ---- filmstrip tiles in view ----
  const sp = project.sprite
  const tileH = 50
  const tileW = sp ? Math.round((tileH * sp.w) / sp.h) : 0
  const tiles: { x: number; k: number }[] = []
  if (sp) {
    for (let x = Math.floor(view.x / tileW) * tileW; x < view.x + view.w && x < D * pps; x += tileW) {
      const t = x / pps
      tiles.push({ x, k: Math.min(sp.count - 1, Math.floor(t / sp.every)) })
    }
  }

  // ---- scrubbing ----
  const scrub = useRef(false)
  const tAt = (e: React.PointerEvent) => {
    const r = scroll.current!.getBoundingClientRect()
    return Math.max(0, Math.min(D, (e.clientX - r.left + scroll.current!.scrollLeft) / pps))
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const el = scroll.current!
    const r = el.getBoundingClientRect()
    const tCursor = (e.clientX - r.left + el.scrollLeft) / pps
    const next = Math.min(400, Math.max(el.clientWidth / D / 1.2, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    p.setPps(next)
    requestAnimationFrame(() => (el.scrollLeft = tCursor * next - (e.clientX - r.left)))
  }

  const sel = p.selection
  const px = (t: number) => t * pps

  /** Starts dragging an item or an edge. Selecting happens right away; seeking waits to see if it was a click. */
  const startDrag = (e: React.PointerEvent, d: DragTarget, select: Selection) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const edge = d.kind === 'clip' ? d.edge : 'any'
    drag.current = { ...d, x0: e.clientX, moved: false, cands: snapCandidates(p.words, p.keep, clock.t, edge) }
    p.onSelect(select)
  }

  /** Applies the drag to a copy of the lists; returns the patch and the time the user is looking at. */
  const dragPatch = (d: Drag, dx: number, free: boolean): { patch: TimelinePatch; at: number; snapped: number | null } => {
    const tol = free ? 0 : SNAP_PX / pps
    let dt = dx / pps
    let snapped: number | null = null
    // Snap the edge that moves; a moved block snaps by whichever of its ends is closer to a candidate.
    const snapEdges = (edges: number[]) => {
      let best: { delta: number; at: number } | null = null
      for (const x of edges) {
        const s = snapTime(x + dt, d.cands, tol)
        if (s.snapped && (!best || Math.abs(s.t - x - dt) < Math.abs(best.delta))) best = { delta: s.t - x - dt, at: s.t }
      }
      if (best) {
        dt += best.delta
        snapped = best.at
      }
    }
    if (d.kind === 'clip') {
      const r = p.keep[d.index]
      const from = d.edge === 'in' ? r.in : r.out
      snapEdges([from])
      const next = trimClip(p.keep, d.index, d.edge, from + dt, D)
      return { patch: { keep: next }, at: d.edge === 'in' ? next[d.index].in : next[d.index].out, snapped }
    }
    if (d.kind === 'chapter') {
      snapEdges([d.t0])
      const t = Math.min(D - 0.01, Math.max(0, d.t0 + dt))
      return { patch: { chapters: p.chapters.map((c, i) => (i === d.index ? { ...c, t } : c)) }, at: t, snapped }
    }
    snapEdges(d.mode === 'move' ? [d.t0, d.t0 + d.d0] : [d.mode === 'in' ? d.t0 : d.t0 + d.d0])
    if (d.kind === 'gfx') {
      const s = moveSpan(d.t0, d.d0, d.mode, dt, D, 0.5, 12)
      return { patch: { gfx: p.gfx.map((g) => (g.id === d.id ? { ...g, ...s } : g)) }, at: d.mode === 'out' ? s.t + s.d : s.t, snapped }
    }
    const s = moveSpan(d.t0, d.d0, d.mode, dt, D, 0.3, 8)
    return { patch: { zooms: p.zooms.map((z, i) => (i === d.index ? { ...z, ...s } : z)) }, at: d.mode === 'out' ? s.t + s.d : s.t, snapped }
  }

  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current!
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) < DRAG_PX) return
    d.moved = true
    const r = dragPatch(d, dx, e.altKey)
    setPreview(r.patch)
    setGuide(r.snapped)
    // Show the frame under the edge being dragged, so a trim can be judged on the picture.
    // A clip end shows its last frame, not the first removed one.
    clock.seek(d.kind === 'clip' && d.edge === 'out' ? r.at - 0.04 : r.at)
  }

  const onDragEnd = (e: React.PointerEvent) => {
    const d = drag.current!
    drag.current = null
    setGuide(null)
    if (!d.moved) {
      setPreview(null)
      // A click: same as before dragging existed.
      if (d.kind === 'gfx') clock.seek(d.t0 + 0.6)
      else if (d.kind === 'zoom' || d.kind === 'chapter') clock.seek(d.t0)
      return
    }
    const { patch } = dragPatch(d, e.clientX - d.x0, e.altKey)
    setPreview(null)
    // Lists stay in time order; follow the dragged item to its new index.
    if (patch.zooms) {
      const z = patch.zooms[(d as { index: number }).index]
      const zs = [...patch.zooms].sort((a, b) => a.t - b.t)
      p.onEdit({ zooms: zs }, { kind: 'zoom', index: zs.indexOf(z) })
    } else if (patch.chapters) {
      const c = patch.chapters[(d as { index: number }).index]
      const cs = [...patch.chapters].sort((a, b) => a.t - b.t)
      p.onEdit({ chapters: cs }, { kind: 'chapter', index: cs.indexOf(c) })
    } else if (patch.gfx) {
      p.onEdit({ gfx: [...patch.gfx].sort((a, b) => a.t - b.t) }, p.selection)
    } else p.onEdit(patch, p.selection)
  }

  /** Edge handles: drag to trim or resize. */
  const handles = (onDown: (e: React.PointerEvent, edge: 'in' | 'out') => void, title: string) => (
    <>
      <span className="h in" title={title} onPointerDown={(e) => onDown(e, 'in')} onClick={(e) => e.stopPropagation()} />
      <span className="h out" title={title} onPointerDown={(e) => onDown(e, 'out')} onClick={(e) => e.stopPropagation()} />
    </>
  )

  return (
    <div className="tl">
      <div className="tl-labels">
        <div className="r-ruler">SEC</div>
        <div className="r-pins">PINS</div>
        <div className="r-scene">SCÈNE</div>
        <div className="r-gfx">GFX</div>
        <div className="r-v1">V1</div>
        <div className="r-a1">A1</div>
      </div>
      <div className="tl-scroll" ref={scroll} onScroll={(e) => setView({ x: e.currentTarget.scrollLeft, w: e.currentTarget.clientWidth })} onWheel={onWheel}>
        <div
          className="lanes"
          style={{ width }}
          onPointerDown={(e) => {
            const target = e.target as HTMLElement
            if (target.closest('.clip,.gblock,.gap-r,.pinm,.zoomm,.scene')) return
            scrub.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            p.onSelect(null)
            clock.seek(tAt(e))
          }}
          onPointerMove={(e) => {
            if (drag.current) onDragMove(e)
            else if (scrub.current) clock.seek(tAt(e))
          }}
          onPointerUp={(e) => {
            if (drag.current) onDragEnd(e)
            scrub.current = false
          }}
          onPointerCancel={() => {
            drag.current = null
            setPreview(null)
            setGuide(null)
          }}
        >
          <div className="lane r-ruler">
            {ticks.map(({ t, big }) => (
              <div key={t.toFixed(3)} className={`tick${big ? ' big' : ''}`} style={{ left: px(t) }}>
                {big && <b>{shortTime(t)}</b>}
              </div>
            ))}
          </div>
          <div className="lane r-pins">
            {p.comments.map((c) => (
              <button key={c.id} className={`pinm${c.sketch.length ? ' d' : ''}`} style={{ left: px(c.t) }} title={c.text} aria-label={`Commentaire : ${c.text}`} onClick={() => clock.seek(c.t)} />
            ))}
          </div>
          <div className="lane r-scene">
            {chapters.map((c, i) => (
              <span
                key={i}
                className={`scene${sel?.kind === 'chapter' && sel.index === i ? ' sel' : ''}`}
                style={{ left: px(c.t) }}
                title={`${c.title} — glisser pour déplacer`}
                onPointerDown={(e) => startDrag(e, { kind: 'chapter', index: i, t0: c.t }, { kind: 'chapter', index: i })}
              >
                {c.title}
              </span>
            ))}
          </div>
          <div className="lane r-gfx">
            {gfxList.map((g) => (
              <div
                key={g.id}
                className={`gblock${sel?.kind === 'gfx' && sel.id === g.id ? ' sel' : ''}`}
                style={{ left: px(g.t), width: Math.max(4, px(g.d)) }}
                title={g.props.title || g.props.text}
                onPointerDown={(e) => startDrag(e, { kind: 'gfx', id: g.id, mode: 'move', t0: g.t, d0: g.d }, { kind: 'gfx', id: g.id })}
              >
                <span className="glbl">{labelFor(g)}</span>
                {handles((e, edge) => startDrag(e, { kind: 'gfx', id: g.id, mode: edge, t0: g.t, d0: g.d }, { kind: 'gfx', id: g.id }), 'Glisser pour changer la durée')}
              </div>
            ))}
            {zooms.map((z, i) => (
              <div
                key={i}
                className={`zoomm${sel?.kind === 'zoom' && sel.index === i ? ' sel' : ''}`}
                style={{ left: px(z.t), width: Math.max(4, px(z.d)) }}
                title={`Zoom ${Math.round(z.scale * 100)} %`}
                onPointerDown={(e) => startDrag(e, { kind: 'zoom', index: i, mode: 'move', t0: z.t, d0: z.d }, { kind: 'zoom', index: i })}
              >
                {handles((e, edge) => startDrag(e, { kind: 'zoom', index: i, mode: edge, t0: z.t, d0: z.d }, { kind: 'zoom', index: i }), 'Glisser pour changer la durée')}
              </div>
            ))}
          </div>
          <div className="lane r-v1">
            {sp &&
              tiles.map(({ x, k }) => (
                <div
                  key={x}
                  className="film"
                  style={{
                    left: x,
                    width: tileW,
                    backgroundImage: `url("${mediaUrl(project.id, sp.file)}")`,
                    backgroundSize: `${sp.cols * tileW}px auto`,
                    backgroundPosition: `${-(k % sp.cols) * tileW}px ${-Math.floor(k / sp.cols) * tileH}px`,
                    top: 2,
                    height: tileH
                  }}
                />
              ))}
            {gaps.map((g) => (
              <div
                key={g.in}
                className={`gap-r${sel?.kind === 'gap' && sel.a === g.in ? ' sel' : ''}`}
                style={{ left: px(g.in), width: Math.max(2, px(g.out - g.in)) }}
                title="Passage coupé — Suppr pour le restaurer"
                onClick={() => p.onSelect({ kind: 'gap', a: g.in, b: g.out })}
              />
            ))}
            {keep.map((r, i) => (
              <div
                key={i}
                className={`clip${sel?.kind === 'clip' && sel.index === i ? ' sel' : ''}`}
                style={{ left: px(r.in), width: Math.max(2, px(r.out - r.in)), background: sp ? 'transparent' : undefined }}
                onClick={(e) => {
                  p.onSelect({ kind: 'clip', index: i })
                  const rr = scroll.current!.getBoundingClientRect()
                  clock.seek((e.clientX - rr.left + scroll.current!.scrollLeft) / pps)
                }}
              >
                {px(r.out - r.in) > 70 && <span className="lbl">Clip {i + 1} · {(r.out - r.in).toFixed(1)} s</span>}
                {handles((e, edge) => startDrag(e, { kind: 'clip', index: i, edge }, { kind: 'clip', index: i }), 'Glisser pour raccourcir ou rallonger le plan (Alt : sans magnétisme)')}
              </div>
            ))}
          </div>
          <div className="lane r-a1">
            <canvas ref={wave} className="wave" />
          </div>
          {guide !== null && <div className="snapline" style={{ left: px(guide) }} />}
          <div className="playhead" ref={head} style={{ left: 0 }} />
        </div>
      </div>
    </div>
  )
}

function labelFor(g: GfxItem) {
  const name = { title: 'Titre', lowerThird: 'Lower third', list: 'Liste', callout: 'Accroche', number: 'Chiffre', quote: 'Citation', image: 'Image' }[g.comp]
  return `${name} · ${g.props.title || g.props.text || (g.props.items ?? []).join(', ') || g.props.src || ''}`
}

export { LABEL_W }
