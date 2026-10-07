// Motion design components. Every frame is a pure function of time, so the live preview
// and the exporter (which seeks to exact instants) draw exactly the same thing.
import type { CSSProperties } from 'react'
import type { DesignSystem, GfxItem } from '../../../shared/types'
import { GFX_IN, GFX_OUT, LIST_STAGGER, type CaptionChunk } from '../../../shared/overlay'

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
const easeBack = (p: number) => {
  const c = 1.5
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
}

export interface LayerProps {
  t: number
  gfx: GfxItem[]
  chunks: CaptionChunk[]
  ds: DesignSystem
  uppercase: boolean
  /** Design width in px when the design height is 1080. */
  width: number
}

export function GfxLayer({ t, gfx, chunks, ds, uppercase, width }: LayerProps) {
  const active = gfx.filter((g) => t >= g.t && t < g.t + g.d)
  const chunk = chunks.find((c) => t >= c.start && t < c.end)
  const hasLowerBlock = active.some((g) => g.comp === 'lowerThird')
  return (
    <div style={{ position: 'absolute', inset: 0, width, height: 1080, pointerEvents: 'none', fontFamily: `"${ds.font}", sans-serif` }}>
      {active.map((g) => (
        <Gfx key={g.id} g={g} t={t} ds={ds} width={width} />
      ))}
      {chunk && <Caption chunk={chunk} t={t} ds={ds} uppercase={uppercase} lifted={hasLowerBlock} />}
    </div>
  )
}

function Gfx({ g, t, ds, width }: { g: GfxItem; t: number; ds: DesignSystem; width: number }) {
  const local = t - g.t
  const pin = easeOut(clamp(local / GFX_IN))
  const pout = clamp((g.t + g.d - t) / GFX_OUT)
  const vis = Math.min(pin, pout)
  const panel: CSSProperties = {
    background: ds.bg,
    color: ds.fg,
    borderRadius: ds.radius,
    boxShadow: '0 18px 50px rgba(0,0,0,.35)',
    position: 'relative',
    overflow: 'hidden'
  }
  const bar: CSSProperties = { position: 'absolute', left: 0, top: 0, bottom: 0, width: 12, background: ds.accent }
  const titleFont: CSSProperties = { fontWeight: ds.weight, lineHeight: 1.02, letterSpacing: '-0.01em' }
  const sub: CSSProperties = { fontFamily: 'Figtree, sans-serif', fontWeight: 500, opacity: 0.8 }
  const { title = '', subtitle = '', text = '', items = [] } = g.props

  switch (g.comp) {
    case 'title':
      return (
        <div style={{ position: 'absolute', left: 110, top: 130, maxWidth: width * 0.62, opacity: vis, transform: `translateY(${(1 - pin) * 40}px)` }}>
          <div style={{ ...panel, padding: '34px 52px 38px 58px', clipPath: `inset(0 ${(1 - pin) * 100}% 0 0)` }}>
            <div style={bar} />
            <div style={{ ...titleFont, fontSize: 92 }}>{title}</div>
            {subtitle && <div style={{ ...sub, fontSize: 36, marginTop: 14 }}>{subtitle}</div>}
          </div>
        </div>
      )
    case 'lowerThird':
      return (
        <div style={{ position: 'absolute', left: 110, bottom: 120, opacity: vis, transform: `translateX(${(1 - pin) * -80}px)` }}>
          <div style={{ ...panel, padding: '20px 40px 22px 44px' }}>
            <div style={bar} />
            <div style={{ ...titleFont, fontSize: 52 }}>{title}</div>
            {subtitle && <div style={{ ...sub, fontSize: 28, marginTop: 6 }}>{subtitle}</div>}
          </div>
        </div>
      )
    case 'list':
      return (
        <div style={{ position: 'absolute', left: 110, top: 150, display: 'flex', flexDirection: 'column', gap: 18, opacity: pout }}>
          {title && <div style={{ ...titleFont, fontSize: 40, color: ds.fg, textShadow: '0 2px 12px rgba(0,0,0,.6)', opacity: pin }}>{title}</div>}
          {items.map((it, k) => {
            const p = easeOut(clamp((local - k * LIST_STAGGER) / GFX_IN))
            return (
              <div key={k} style={{ ...panel, padding: '18px 36px 18px 40px', opacity: p, transform: `translateX(${(1 - p) * -60}px)`, alignSelf: 'flex-start' }}>
                <div style={bar} />
                <span style={{ ...titleFont, fontSize: 50 }}>
                  <span style={{ color: ds.accent, marginRight: 18 }}>{k + 1}</span>
                  {it}
                </span>
              </div>
            )
          })}
        </div>
      )
    case 'callout': {
      const s = easeBack(clamp(local / GFX_IN))
      return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 120, display: 'flex', justifyContent: 'center', opacity: vis }}>
          <div style={{ background: ds.accent, color: ds.bg, borderRadius: ds.radius + 6, padding: '18px 44px', ...titleFont, fontSize: 76, transform: `scale(${0.6 + 0.4 * s}) rotate(${(1 - s) * -4}deg)`, boxShadow: '0 18px 50px rgba(0,0,0,.35)' }}>
            {text || title}
          </div>
        </div>
      )
    }
    case 'number': {
      const target = parseFloat(title.replace(/[^\d.,-]/g, '').replace(',', '.'))
      const shown = Number.isFinite(target) ? formatLike(title, target * easeOut(clamp(local / 0.9))) : title
      return (
        <div style={{ position: 'absolute', right: 120, top: 150, opacity: vis, transform: `translateY(${(1 - pin) * 30}px)`, textAlign: 'right' }}>
          <div style={{ ...panel, padding: '22px 44px 28px' }}>
            <div style={{ ...titleFont, fontSize: 168, color: ds.accent }}>{shown}</div>
            {subtitle && <div style={{ ...sub, fontSize: 34, marginTop: 4 }}>{subtitle}</div>}
          </div>
        </div>
      )
    }
    case 'quote':
      return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 200, display: 'flex', justifyContent: 'center', opacity: vis, transform: `translateY(${(1 - pin) * 30}px)` }}>
          <div style={{ ...panel, padding: '36px 56px', maxWidth: width * 0.66 }}>
            <div style={{ position: 'absolute', left: 22, top: -6, fontSize: 150, color: ds.accent, fontWeight: 800, lineHeight: 1 }}>“</div>
            <div style={{ ...titleFont, fontSize: 56, lineHeight: 1.15, paddingLeft: 40 }}>{text || title}</div>
          </div>
        </div>
      )
  }
}

/** Animate "2 000 €" or "87%" while keeping its suffix and prefix. */
function formatLike(src: string, v: number): string {
  const m = src.match(/^([^\d-]*)([-\d\s.,]+)(.*)$/)
  if (!m) return src
  const decimals = (m[2].split(/[.,]/)[1] ?? '').replace(/\s/g, '').length
  const n = v.toFixed(decimals)
  const grouped = Number(n).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return m[1] + grouped + m[3]
}

function Caption({ chunk, t, ds, uppercase, lifted }: { chunk: CaptionChunk; t: number; ds: DesignSystem; uppercase: boolean; lifted: boolean }) {
  let active = -1
  chunk.words.forEach((w, i) => {
    if (t >= w.start) active = i
  })
  return (
    <div style={{ position: 'absolute', left: 80, right: 80, bottom: lifted ? 300 : 120, display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0 22px' }}>
      {chunk.words.map((w, i) => (
        <span
          key={i}
          style={{
            fontFamily: `"${ds.font}", sans-serif`,
            fontWeight: Math.max(ds.weight, 700),
            fontSize: 74,
            lineHeight: 1.15,
            color: i === active ? ds.accent : '#ffffff',
            textTransform: uppercase ? 'uppercase' : 'none',
            WebkitTextStroke: '10px rgba(0,0,0,.85)',
            paintOrder: 'stroke fill',
            textShadow: '0 6px 18px rgba(0,0,0,.45)'
          }}
        >
          {w.text.replace(/[.,;:]$/, '')}
        </span>
      ))}
    </div>
  )
}
