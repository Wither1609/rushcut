// Motion design components. Every frame is a pure function of time, so the live preview
// and the exporter (which seeks to exact instants) draw exactly the same thing.
import type { CSSProperties } from 'react'
import type { CaptionStyle, DesignSystem, GfxItem } from '../../../shared/types'
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
  /** Design height in px (1080 for landscape; 1920 for a 1080-wide vertical export). */
  height?: number
  /** For image graphics: rushcut://p/<projectId>/assets/<file>. */
  projectId?: string
  captionStyle?: CaptionStyle
}

const assetUrl = (projectId: string | undefined, file: string) => `rushcut://p/${encodeURIComponent(projectId ?? '')}/assets/${encodeURIComponent(file)}`

export function GfxLayer({ t, gfx, chunks, ds, uppercase, width, height = 1080, captionStyle = 'karaoke', projectId }: LayerProps) {
  // Vertical frames: keep text clear of the platform UI (top bar, buttons and description at the bottom).
  const tall = height > width
  const active = gfx.filter((g) => t >= g.t && t < g.t + g.d)
  const chunk = chunks.find((c) => t >= c.start && t < c.end)
  const hasLowerBlock = active.some((g) => g.comp === 'lowerThird')
  return (
    <div style={{ position: 'absolute', inset: 0, width, height, pointerEvents: 'none', fontFamily: `"${ds.font}", sans-serif` }}>
      {active.map((g) => (
        <Gfx key={g.id} g={g} t={t} ds={ds} width={width} tall={tall} projectId={projectId} />
      ))}
      {chunk && <Caption chunk={chunk} t={t} ds={ds} uppercase={uppercase} bottom={tall ? (hasLowerBlock ? 660 : 520) : hasLowerBlock ? 300 : 120} style={captionStyle} />}
    </div>
  )
}

function Gfx({ g, t, ds, width, tall, projectId }: { g: GfxItem; t: number; ds: DesignSystem; width: number; tall: boolean; projectId?: string }) {
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
        <div style={{ position: 'absolute', left: tall ? 80 : 110, top: tall ? 300 : 130, maxWidth: width * (tall ? 0.84 : 0.62), opacity: vis, transform: `translateY(${(1 - pin) * 40}px)` }}>
          <div style={{ ...panel, padding: '34px 52px 38px 58px', clipPath: `inset(0 ${(1 - pin) * 100}% 0 0)` }}>
            <div style={bar} />
            <div style={{ ...titleFont, fontSize: 92 }}>{title}</div>
            {subtitle && <div style={{ ...sub, fontSize: 36, marginTop: 14 }}>{subtitle}</div>}
          </div>
        </div>
      )
    case 'lowerThird':
      return (
        <div style={{ position: 'absolute', left: tall ? 80 : 110, bottom: tall ? 420 : 120, opacity: vis, transform: `translateX(${(1 - pin) * -80}px)` }}>
          <div style={{ ...panel, padding: '20px 40px 22px 44px' }}>
            <div style={bar} />
            <div style={{ ...titleFont, fontSize: 52 }}>{title}</div>
            {subtitle && <div style={{ ...sub, fontSize: 28, marginTop: 6 }}>{subtitle}</div>}
          </div>
        </div>
      )
    case 'list':
      return (
        <div style={{ position: 'absolute', left: tall ? 80 : 110, top: tall ? 300 : 150, display: 'flex', flexDirection: 'column', gap: 18, opacity: pout }}>
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
        <div style={{ position: 'absolute', left: 0, right: 0, top: tall ? 300 : 120, display: 'flex', justifyContent: 'center', opacity: vis }}>
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
        <div style={{ position: 'absolute', right: tall ? 80 : 120, top: tall ? 300 : 150, opacity: vis, transform: `translateY(${(1 - pin) * 30}px)`, textAlign: 'right' }}>
          <div style={{ ...panel, padding: '22px 44px 28px' }}>
            <div style={{ ...titleFont, fontSize: 168, color: ds.accent }}>{shown}</div>
            {subtitle && <div style={{ ...sub, fontSize: 34, marginTop: 4 }}>{subtitle}</div>}
          </div>
        </div>
      )
    }
    case 'image': {
      if (!g.props.src) return null
      const url = assetUrl(projectId, g.props.src)
      if (g.props.layout === 'full') {
        // Full-screen cutaway with a slow push-in over its whole duration.
        const push = 1.03 + 0.07 * clamp(local / g.d)
        return (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: vis, background: '#000' }}>
            <img src={url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${push})` }} />
            {title && (
              <div style={{ position: 'absolute', left: tall ? 70 : 90, bottom: tall ? 380 : 110, ...panel, padding: '16px 34px 18px 40px', transform: `translateX(${(1 - pin) * -60}px)` }}>
                <div style={bar} />
                <div style={{ ...titleFont, fontSize: 44 }}>{title}</div>
                {subtitle && <div style={{ ...sub, fontSize: 24, marginTop: 4 }}>{subtitle}</div>}
              </div>
            )}
          </div>
        )
      }
      const s = easeBack(clamp(local / GFX_IN))
      const narrow = tall || width < 1300
      const w = narrow ? width * 0.78 : Math.min(width * 0.4, 780)
      return (
        <div
          style={{
            position: 'absolute',
            top: tall ? 300 : narrow ? 150 : 120,
            ...(narrow ? { left: (width - w) / 2 } : { right: 110 }),
            width: w,
            opacity: vis,
            transform: `translateY(${(1 - s) * 50}px) scale(${0.88 + 0.12 * s}) rotate(${(1 - s) * 3 - 1.2}deg)`,
            transformOrigin: '50% 100%'
          }}
        >
          <div style={{ ...panel, padding: 12, borderBottom: `10px solid ${ds.accent}` }}>
            <img src={url} alt="" style={{ display: 'block', width: '100%', maxHeight: narrow ? 760 : 640, objectFit: 'cover', borderRadius: Math.max(0, ds.radius - 6) }} />
            {title && <div style={{ ...titleFont, fontSize: 36, padding: '14px 8px 4px' }}>{title}</div>}
          </div>
        </div>
      )
    }
    case 'quote':
      return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: tall ? 340 : 200, display: 'flex', justifyContent: 'center', opacity: vis, transform: `translateY(${(1 - pin) * 30}px)` }}>
          <div style={{ ...panel, padding: '36px 56px', maxWidth: width * (tall ? 0.86 : 0.66) }}>
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

function Caption({ chunk, t, ds, uppercase, bottom, style }: { chunk: CaptionChunk; t: number; ds: DesignSystem; uppercase: boolean; bottom: number; style: CaptionStyle }) {
  let active = -1
  chunk.words.forEach((w, i) => {
    if (t >= w.start) active = i
  })
  const clean = (x: string) => x.replace(/[.,;:]$/, '')
  const row: CSSProperties = { position: 'absolute', left: 80, right: 80, bottom, display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0 22px' }
  const caps = uppercase ? 'uppercase' : 'none'

  if (style === 'box') {
    return (
      <div style={row}>
        <div style={{ background: ds.bg, borderRadius: ds.radius + 4, padding: '10px 18px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', boxShadow: '0 14px 40px rgba(0,0,0,.35)' }}>
          {chunk.words.map((w, i) => (
            <span
              key={i}
              style={{
                fontFamily: `"${ds.font}", sans-serif`,
                fontWeight: Math.max(ds.weight, 700),
                fontSize: 62,
                lineHeight: 1.2,
                padding: '2px 14px',
                borderRadius: Math.max(4, ds.radius - 2),
                textTransform: caps,
                background: i === active ? ds.accent : 'transparent',
                color: i === active ? ds.bg : ds.fg
              }}
            >
              {clean(w.text)}
            </span>
          ))}
        </div>
      </div>
    )
  }

  if (style === 'minimal') {
    return (
      <div style={{ ...row, bottom: bottom - 30, gap: '0 14px' }}>
        {chunk.words.map((w, i) => (
          <span
            key={i}
            style={{
              fontFamily: 'Figtree, sans-serif',
              fontWeight: 700,
              fontSize: 52,
              lineHeight: 1.2,
              color: '#ffffff',
              opacity: i <= active ? 1 : 0.55,
              textTransform: caps,
              textShadow: '0 2px 4px rgba(0,0,0,.7), 0 6px 24px rgba(0,0,0,.5)'
            }}
          >
            {clean(w.text)}
          </span>
        ))}
      </div>
    )
  }

  // karaoke: the spoken word takes the accent colour. pop: it also jumps in.
  return (
    <div style={row}>
      {chunk.words.map((w, i) => {
        const on = i === active
        const bounce = style === 'pop' && on ? easeBack(clamp((t - w.start) / 0.18)) : 1
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              fontFamily: `"${ds.font}", sans-serif`,
              fontWeight: Math.max(ds.weight, 700),
              fontSize: 74,
              lineHeight: 1.15,
              color: on ? ds.accent : '#ffffff',
              textTransform: caps,
              WebkitTextStroke: '10px rgba(0,0,0,.85)',
              paintOrder: 'stroke fill',
              textShadow: '0 6px 18px rgba(0,0,0,.45)',
              transform: style === 'pop' && on ? `scale(${0.85 + 0.3 * bounce}) rotate(${(1 - bounce) * -4}deg)` : undefined
            }}
          >
            {clean(w.text)}
          </span>
        )
      })}
    </div>
  )
}
