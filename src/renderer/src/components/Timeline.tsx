import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clock } from '../clock'
import { mediaUrl } from '../api'
import { keepIndexAt, shortTime } from '../../../shared/edl'
import { PEAKS_PER_SEC, type Chapter, type Comment, type GfxItem, type Project, type Range, type Zoom } from '../../../shared/types'

export type Selection = { kind: 'clip'; index: number } | { kind: 'gap'; a: number; b: number } | { kind: 'gfx'; id: string } | { kind: 'words'; a: number; b: number } | null

interface Props {
  project: Project
  keep: Range[]
  gfx: GfxItem[]
  zooms: Zoom[]
  chapters: Chapter[]
  comments: Comment[]
  peaks: number[]
  pps: number
  setPps: (v: number) => void
  selection: Selection
  onSelect: (s: Selection) => void
}

const LABEL_W = 64
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200]

export function Timeline(p: Props) {
  const { project, keep, pps } = p
  const D = project.media.duration
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
            if (target.closest('.clip,.gblock,.gap-r,.pinm')) return
            scrub.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            p.onSelect(null)
            clock.seek(tAt(e))
          }}
          onPointerMove={(e) => scrub.current && clock.seek(tAt(e))}
          onPointerUp={() => (scrub.current = false)}
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
            {p.chapters.map((c, i) => (
              <span key={i} className="scene" style={{ left: px(c.t) }}>{c.title}</span>
            ))}
          </div>
          <div className="lane r-gfx">
            {p.gfx.map((g) => (
              <div
                key={g.id}
                className={`gblock${sel?.kind === 'gfx' && sel.id === g.id ? ' sel' : ''}`}
                style={{ left: px(g.t), width: Math.max(4, px(g.d)) }}
                title={g.props.title || g.props.text}
                onClick={() => {
                  p.onSelect({ kind: 'gfx', id: g.id })
                  clock.seek(g.t + 0.6)
                }}
              >
                {labelFor(g)}
              </div>
            ))}
            {p.zooms.map((z, i) => (
              <div key={i} className="zoomm" style={{ left: px(z.t), width: px(z.d) }} title={`Zoom ${Math.round(z.scale * 100)} %`} />
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
                key={`${r.in}-${i}`}
                className={`clip${sel?.kind === 'clip' && sel.index === i ? ' sel' : ''}`}
                style={{ left: px(r.in), width: Math.max(2, px(r.out - r.in)), background: sp ? 'transparent' : undefined }}
                onClick={(e) => {
                  p.onSelect({ kind: 'clip', index: i })
                  const rr = scroll.current!.getBoundingClientRect()
                  clock.seek((e.clientX - rr.left + scroll.current!.scrollLeft) / pps)
                }}
              >
                {px(r.out - r.in) > 70 && <span className="lbl">Clip {i + 1} · {(r.out - r.in).toFixed(1)} s</span>}
              </div>
            ))}
          </div>
          <div className="lane r-a1">
            <canvas ref={wave} className="wave" />
          </div>
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
