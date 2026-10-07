import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { clock } from '../clock'
import { mediaUrl } from '../api'
import { GfxLayer } from '../gfx/GfxLayer'
import { drawShape, INK_COLORS, shapeIsUsable } from '../ink'
import { nextPlayable, tc } from '../../../shared/edl'
import type { CaptionChunk } from '../../../shared/overlay'
import type { Comment, DesignSystem, Edl, Project, Shape, ShapeTool } from '../../../shared/types'

export interface PlayerHandle {
  toggle: () => void
  play: () => void
  pause: () => void
  step: (dt: number) => void
  /** JPEG of the current frame with the given drawing on top, for Claude. */
  captureFrame: (shapes: Shape[]) => string | null
}

interface Props {
  project: Project
  edl: Edl
  chunks: CaptionChunk[]
  ds: DesignSystem
  comments: Comment[]
  drawMode: boolean
  skipCuts: boolean
  speed: number
  onAttach: (shapes: Shape[]) => void
  onCloseDraw: () => void
}

const TOOLS: { id: ShapeTool; label: string; icon: React.ReactNode }[] = [
  { id: 'pen', label: 'Crayon', icon: <path d="M4 20c2-6 5-2 7-8s4-7 6-6-1 5 1 6 3-1 3-1" /> },
  { id: 'ellipse', label: 'Cercle', icon: <ellipse cx="12" cy="12" rx="8" ry="6.5" /> },
  { id: 'arrow', label: 'Flèche', icon: <path d="M5 19L19 5M10 5h9v9" /> },
  { id: 'rect', label: 'Rectangle', icon: <rect x="5" y="6" width="14" height="12" rx="1.5" /> }
]

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

export const Player = forwardRef<PlayerHandle, Props>(function Player(p, ref) {
  const { project, edl } = p
  const viewer = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const ink = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 640, h: 360 })
  const aspect = project.media.width / project.media.height
  const src = project.ready.proxy ? mediaUrl(project.id, 'proxy.mp4') : mediaUrl(project.id, '__source')
  const [mediaError, setMediaError] = useState(false)
  const edlRef = useRef(edl)
  edlRef.current = edl
  const skipRef = useRef(p.skipCuts)
  skipRef.current = p.skipCuts

  // Fit the 16:9 (or any aspect) screen inside the viewer.
  useEffect(() => {
    const el = viewer.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const w = Math.min(r.width, r.height * aspect)
      setBox({ w: Math.floor(w), h: Math.floor(w / aspect) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect])

  // ---- playback loop -------------------------------------------------------
  const applyZoom = useCallback((t: number) => {
    const z = edlRef.current.zooms.find((z) => t >= z.t && t < z.t + z.d)
    if (video.current) video.current.style.transform = z ? `scale(${z.scale})` : ''
  }, [])

  useEffect(() => {
    const v = video.current!
    let raf = 0
    const tick = () => {
      let t = v.currentTime
      if (skipRef.current) {
        const n = nextPlayable(edlRef.current.keep, t)
        if (n === null) {
          v.pause()
          return
        }
        if (n - t > 0.01) {
          v.currentTime = n
          t = n
        }
      }
      clock.set(t)
      applyZoom(t)
      raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      clock.setPlaying(true)
      raf = requestAnimationFrame(tick)
    }
    const onPause = () => {
      clock.setPlaying(false)
      cancelAnimationFrame(raf)
      clock.set(v.currentTime)
    }
    const onSeeked = () => {
      if (v.paused) {
        clock.set(v.currentTime)
        applyZoom(v.currentTime)
      }
    }
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)
    clock.seekImpl = (t) => {
      const c = Math.max(0, Math.min(project.media.duration - 0.01, t))
      v.currentTime = c
      clock.set(c)
      applyZoom(c)
    }
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', onSeeked)
    }
  }, [applyZoom, project.media.duration])

  useEffect(() => {
    if (video.current) video.current.playbackRate = p.speed
  }, [p.speed])

  // Keep the position when the proxy replaces the raw source.
  useEffect(() => {
    const v = video.current!
    const onMeta = () => {
      v.currentTime = clock.t
      v.playbackRate = p.speed
    }
    v.addEventListener('loadedmetadata', onMeta)
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [src, p.speed])

  const play = useCallback(() => {
    const v = video.current!
    if (skipRef.current) {
      const n = nextPlayable(edlRef.current.keep, v.currentTime)
      if (n === null) v.currentTime = edlRef.current.keep[0]?.in ?? 0
    }
    void v.play().catch(() => undefined)
  }, [])

  // ---- drawing ---------------------------------------------------------------
  const [tool, setTool] = useState<ShapeTool>('pen')
  const [color, setColor] = useState(INK_COLORS[0])
  const [live, setLive] = useState<Shape[]>([])
  const cur = useRef<Shape | null>(null)
  const nearSketchKey = useRef('')

  const redrawInk = useCallback(() => {
    const c = ink.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const t = clock.t
    for (const cm of p.comments) if (!cm.fixedIn && cm.sketch.length && Math.abs(cm.t - t) < 1.2) cm.sketch.forEach((s) => drawShape(ctx, s, c.width, c.height))
    for (const s of live) drawShape(ctx, s, c.width, c.height)
    if (cur.current) drawShape(ctx, cur.current, c.width, c.height)
  }, [p.comments, live])

  useEffect(() => {
    const c = ink.current!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = box.w * dpr
    c.height = box.h * dpr
    redrawInk()
  }, [box, redrawInk])

  // Saved drawings reappear only around their timecode; redraw when that set changes.
  useEffect(
    () =>
      clock.subscribe((t) => {
        const key = p.comments.filter((cm) => !cm.fixedIn && cm.sketch.length && Math.abs(cm.t - t) < 1.2).map((c) => c.id).join()
        if (key !== nearSketchKey.current) {
          nearSketchKey.current = key
          redrawInk()
        }
      }),
    [p.comments, redrawInk]
  )

  useEffect(() => {
    if (!p.drawMode) setLive([])
  }, [p.drawMode])

  const pt = (e: React.PointerEvent): [number, number] => {
    const r = ink.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  const attach = useCallback(() => {
    if (live.length) p.onAttach(live)
  }, [live, p])

  useEffect(() => {
    if (!p.drawMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        attach()
      } else if (e.key === 'Escape') p.onCloseDraw()
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setLive((l) => l.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p.drawMode, attach, p])

  useImperativeHandle(
    ref,
    () => ({
      toggle: () => (video.current!.paused ? play() : video.current!.pause()),
      play,
      pause: () => video.current!.pause(),
      step: (dt) => {
        video.current!.pause()
        clock.seek(video.current!.currentTime + dt)
      },
      captureFrame: (shapes) => {
        const v = video.current
        if (!v || !v.videoWidth) return null
        const W = 960
        const H = Math.round(W / aspect)
        const c = document.createElement('canvas')
        c.width = W
        c.height = H
        const ctx = c.getContext('2d')!
        ctx.drawImage(v, 0, 0, W, H)
        shapes.forEach((s) => drawShape(ctx, s, W, H))
        return c.toDataURL('image/jpeg', 0.85)
      }
    }),
    [aspect, play]
  )

  const designW = 1080 * aspect
  return (
    <div className="viewer" ref={viewer}>
      <div className={`screen${p.drawMode ? ' drawing' : ''}`} style={{ width: box.w, height: box.h }}>
        <video
          ref={video}
          src={src}
          preload="auto"
          playsInline
          onError={() => setMediaError(true)}
          onLoadedData={() => setMediaError(false)}
        />
        <div style={{ position: 'absolute', left: 0, top: 0, width: designW, height: 1080, transform: `scale(${box.h / 1080})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
          <Overlay edl={edl} chunks={p.chunks} ds={p.ds} width={designW} projectId={project.id} />
        </div>
        <canvas
          ref={ink}
          className="ink"
          style={{ pointerEvents: p.drawMode ? 'auto' : 'none' }}
          onPointerDown={(e) => {
            if (!p.drawMode) return
            video.current!.pause()
            e.currentTarget.setPointerCapture(e.pointerId)
            const a = pt(e)
            cur.current = tool === 'pen' ? { tool, color, pts: [a] } : { tool, color, a, b: a }
          }}
          onPointerMove={(e) => {
            const s = cur.current
            if (!s) return
            if (s.tool === 'pen') s.pts!.push(pt(e))
            else s.b = pt(e)
            redrawInk()
          }}
          onPointerUp={() => {
            const s = cur.current
            cur.current = null
            if (s && shapeIsUsable(s)) setLive((l) => [...l, s])
            else redrawInk()
          }}
        />
        <span className="badge">{edl.version}</span>
        {mediaError && (
          <div className="notice">
            {project.ready.proxy ? 'Lecture impossible.' : 'Ce format ne se lit pas directement. Le proxy est en préparation, la vidéo apparaîtra dès qu’il est prêt.'}
          </div>
        )}
        {p.drawMode && (
          <div className="inkbar" role="toolbar" aria-label="Outils de dessin">
            {TOOLS.map((t) => (
              <button key={t.id} className="ib" aria-pressed={tool === t.id} aria-label={t.label} title={t.label} onClick={() => setTool(t.id)}>
                <Icon>{t.icon}</Icon>
              </button>
            ))}
            <span className="sep" />
            {INK_COLORS.map((c) => (
              <button key={c} className="ib col" aria-pressed={color === c} aria-label={`Couleur ${c}`} style={{ color: c }} onClick={() => setColor(c)}>
                <i className="dot" style={{ background: c }} />
              </button>
            ))}
            <span className="sep" />
            <button className="ib" aria-label="Annuler le dernier trait" title="Annuler (Ctrl/⌘+Z)" disabled={!live.length} onClick={() => setLive((l) => l.slice(0, -1))}>
              <Icon>
                <path d="M9 14L4 9l5-5" />
                <path d="M4 9h10a6 6 0 010 12h-3" />
              </Icon>
            </button>
            <button className="ib" aria-label="Fermer sans joindre" title="Fermer (Échap)" onClick={p.onCloseDraw}>
              <Icon>
                <path d="M6 6l12 12M18 6L6 18" />
              </Icon>
            </button>
            <button className="attach" disabled={!live.length} onClick={attach}>
              Joindre <kbd>↵</kbd>
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

/** The only part of the screen that re-renders every frame during playback. */
function Overlay({ edl, chunks, ds, width, projectId }: { edl: Edl; chunks: CaptionChunk[]; ds: DesignSystem; width: number; projectId: string }) {
  const t = useSyncExternalStore((cb) => clock.subscribe(cb), () => clock.t)
  const gfx = useMemo(() => edl.gfx, [edl.gfx])
  return <GfxLayer t={t} gfx={gfx} chunks={edl.captions.enabled ? chunks : []} ds={ds} uppercase={edl.captions.uppercase} width={width} captionStyle={edl.captions.style} projectId={projectId} />
}

export function Timecode({ duration }: { duration: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let last = ''
    return clock.subscribe((t) => {
      const s = tc(t)
      if (s !== last && ref.current) {
        last = s
        ref.current.firstChild!.textContent = s + ' '
      }
    })
  }, [])
  return (
    <div className="tc" ref={ref}>
      {tc(clock.t) + ' '}
      <span>/ {tc(duration)}</span>
    </div>
  )
}
