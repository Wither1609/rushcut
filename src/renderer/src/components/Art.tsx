// Small animated illustrations used by the onboarding and the Style panel. Pure CSS/SVG, no assets.
import { useEffect, useRef, useState } from 'react'
import { GfxLayer } from '../gfx/GfxLayer'
import type { CaptionStyle, DesignSystem } from '../../../shared/types'
import type { CaptionChunk } from '../../../shared/overlay'

const Person = ({ x = 50, scale = 1 }: { x?: number; scale?: number }) => (
  <svg className="person" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <g transform={`translate(${x - 50 * scale} ${100 - 100 * scale}) scale(${scale})`}>
      <circle cx="50" cy="42" r="15" />
      <path d="M18 100c0-22 14-36 32-36s32 14 32 36z" />
    </g>
  </svg>
)

/** One illustration per video template. */
export function TemplateArt({ id }: { id: string }) {
  switch (id) {
    case 'reel':
      return (
        <div className="art">
          <div className="frame phone">
            <Person />
            <div className="cap-loop">
              <span>ÇA</span>
              <span>CHANGE</span>
              <span>TOUT</span>
            </div>
            <i className="flash" />
          </div>
        </div>
      )
    case 'tuto':
      return (
        <div className="art">
          <div className="frame wide">
            <Person x={74} scale={0.8} />
            <div className="list-loop">
              <b>3 étapes</b>
              <span><em>1</em></span>
              <span><em>2</em></span>
              <span><em>3</em></span>
            </div>
          </div>
        </div>
      )
    case 'podcast':
      return (
        <div className="art">
          <div className="frame square">
            <div className="duo">
              <i />
              <i />
            </div>
            <div className="wave-loop">
              {Array.from({ length: 14 }, (_, k) => (
                <span key={k} style={{ animationDelay: `${(k * 97) % 600}ms` }} />
              ))}
            </div>
          </div>
        </div>
      )
    case 'pub':
      return (
        <div className="art">
          <div className="frame phone">
            <div className="product" />
            <span className="promo">−30 %</span>
            <span className="cta">Commander</span>
          </div>
        </div>
      )
    case 'interview':
      return (
        <div className="art">
          <div className="frame wide">
            <Person x={40} scale={0.95} />
            <div className="l3-loop">
              <b>Camille Durand</b>
              <span>Fondatrice</span>
            </div>
          </div>
        </div>
      )
    case 'vlog':
      return (
        <div className="art">
          <div className="frame wide scenic">
            <svg viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">
              <circle className="sun" cx="118" cy="30" r="11" />
              <path d="M0 90L42 44l26 26 30-38 62 58z" fill="rgba(255,255,255,.16)" />
              <path d="M0 90l30-22 30 14 40-30 60 38z" fill="rgba(255,255,255,.28)" />
            </svg>
            <span className="chap">Jour 1 · Lisbonne</span>
          </div>
        </div>
      )
    default:
      return (
        <div className="art">
          <div className="frame wide ref">
            <div className="ref-a" />
            <svg viewBox="0 0 24 24" className="ref-arrow" aria-hidden="true">
              <path d="M4 12h14M13 6l6 6-6 6" />
            </svg>
            <div className="ref-b" />
          </div>
        </div>
      )
  }
}

/** Shot lengths sliding by: short shots for a punchy pace, long ones for a calm one. */
export function PaceArt({ pace }: { pace: 'calm' | 'balanced' | 'punchy' }) {
  const widths = { calm: [62, 48, 70, 56], balanced: [34, 26, 40, 30, 36, 28], punchy: [14, 10, 18, 12, 9, 16, 11, 15, 10, 13] }[pace]
  const strip = [...widths, ...widths]
  return (
    <div className="art">
      <div className={`pace-strip ${pace}`}>
        <div className="track">
          {strip.map((w, k) => (
            <i key={k} style={{ width: w }} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function ZoomArt({ level }: { level: 'none' | 'subtle' | 'dynamic' }) {
  return (
    <div className="art">
      <div className={`frame wide zoom-${level}`}>
        <div className="zoom-inner">
          <Person />
        </div>
      </div>
    </div>
  )
}

export function GfxArt({ level }: { level: 'none' | 'light' | 'rich' }) {
  return (
    <div className="art">
      <div className="frame wide">
        <Person x={level === 'rich' ? 70 : 50} scale={0.85} />
        {level !== 'none' && <span className="g-call">WOW</span>}
        {level === 'rich' && (
          <>
            <span className="g-title">Partie 2</span>
            <span className="g-num">87 %</span>
          </>
        )}
      </div>
    </div>
  )
}

/** Shared looping clock for live previews. */
export function useLoop(period: number) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setT(period * 0.4)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      setT(((now - t0) / 1000) % period)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [period])
  return t
}

const SAMPLE: CaptionChunk = {
  start: 0,
  end: 2.4,
  words: [
    { text: 'Ça', start: 0.1, end: 0.5 },
    { text: 'change', start: 0.6, end: 1.2 },
    { text: 'tout', start: 1.3, end: 2.2 }
  ]
}

/** The real caption renderer, scaled down, so the preview matches the export exactly. */
export function CaptionPreview({ style, ds, t, vertical }: { style: CaptionStyle; ds: DesignSystem; t: number; vertical?: boolean }) {
  // A tighter virtual frame than the real 1920×1080 keeps the words legible in a small card.
  const W = vertical ? 1080 : 1200
  const H = vertical ? 1920 : 680
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.1)
  useEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [W])
  return (
    <div className="cap-preview" ref={box} style={{ aspectRatio: `${W} / ${H}` }}>
      <Person />
      <div className="cap-scale" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        <GfxLayer t={t} gfx={[]} chunks={[SAMPLE]} ds={ds} uppercase={style !== 'minimal'} width={W} height={H} captionStyle={style} />
      </div>
    </div>
  )
}
