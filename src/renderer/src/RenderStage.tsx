// Hidden page used by the exporter: it receives the overlay data, then the main process seeks
// it to each instant and captures a transparent frame.
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { GfxLayer } from './gfx/GfxLayer'
import { mediaUrl } from './api'
import type { CaptionStyle, DesignSystem, GfxItem } from '../../shared/types'
import type { CaptionChunk } from '../../shared/overlay'

interface Payload {
  gfx: GfxItem[]
  chunks: CaptionChunk[]
  ds: DesignSystem
  W: number
  H: number
  uppercase: boolean
  projectId: string
  captionStyle?: CaptionStyle
}

const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

export function RenderStage() {
  const [p, setP] = useState<Payload | null>(null)
  const [t, setT] = useState(0)

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    window.__rcSetup = async (payload) => {
      const pl = payload as Payload
      flushSync(() => setP(pl))
      await document.fonts.load(`${pl.ds.weight} 80px "${pl.ds.font}"`).catch(() => undefined)
      await document.fonts.load(`700 80px "${pl.ds.font}"`).catch(() => undefined)
      await document.fonts.load(`500 30px "Figtree"`).catch(() => undefined)
      await document.fonts.ready
      // Image graphics must be decoded before the first capture, or the first frames come out empty.
      await Promise.all(
        pl.gfx
          .filter((g) => g.comp === 'image' && g.props.src)
          .map((g) => {
            const img = new Image()
            img.src = mediaUrl(pl.projectId, `assets/${g.props.src}`)
            return img.decode().catch(() => undefined)
          })
      )
      await frames()
    }
    window.__rcSeek = async (time) => {
      flushSync(() => setT(time))
      await frames()
    }
  }, [])

  if (!p) return null
  // Graphics are designed for a 1080 px short side: 1920×1080 in landscape, 1080×1920 in vertical.
  const scale = Math.min(p.W, p.H) / 1080
  const w = p.W / scale
  const h = p.H / scale
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <GfxLayer t={t} gfx={p.gfx} chunks={p.chunks} ds={p.ds} uppercase={p.uppercase} width={w} height={h} projectId={p.projectId} captionStyle={p.captionStyle} />
      </div>
    </div>
  )
}
