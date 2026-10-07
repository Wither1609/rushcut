import { useState } from 'react'
import { mediaUrl } from '../api'
import { TEMPLATES } from '../../../shared/templates'
import type { ExportOptions, Project } from '../../../shared/types'

type Extra = Pick<ExportOptions, 'aspect' | 'cropX' | 'srt'>

interface Props {
  project: Project
  versions: string[]
  current: string
  onClose: () => void
  onExport: (v: string, height: 720 | 1080 | 2160, burn: boolean, extra: Extra) => void
}

export function ExportModal({ project, versions, current, onClose, onExport }: Props) {
  const { media } = project
  const [version, setVersion] = useState(current)
  // A project started from a vertical template (Reel / Short) exports in 9:16 by default.
  const tpl = TEMPLATES.find((t) => t.id === project.brief?.template)
  const [aspect, setAspect] = useState<'source' | '9:16'>(tpl?.format === '9:16' && media.width > media.height ? '9:16' : 'source')
  const vertical = aspect === '9:16'
  const options = vertical ? ([720, 1080] as const) : ([720, 1080, 2160] as const).filter((h) => h <= Math.max(720, media.height))
  const [height, setHeight] = useState<720 | 1080 | 2160>(1080)
  const h = (options as readonly number[]).includes(height) ? height : options[options.length - 1]
  const [burn, setBurn] = useState(true)
  const [srt, setSrt] = useState(false)
  const [cropX, setCropX] = useState(0.5)
  // Share of the rush width kept by the vertical crop (1 when the rush is already narrower than 9:16).
  const keepW = Math.min(1, (media.height * 9) / 16 / media.width)

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sm" role="dialog" aria-label="Exporter">
        <div className="modal-h">
          <h2>Exporter</h2>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Fermer</button>
        </div>
        <label className="field">
          <span>Version</span>
          <select id="export-version" className="select" value={version} onChange={(e) => setVersion(e.target.value)}>
            {versions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <div className="field">
          <span className="muted" style={{ fontSize: 12 }}>Format</span>
          <div className="seg">
            <button aria-pressed={!vertical} onClick={() => setAspect('source')}>Original {media.width > media.height ? '16:9' : ''}</button>
            <button aria-pressed={vertical} onClick={() => setAspect('9:16')}>Vertical 9:16</button>
          </div>
        </div>
        {vertical && keepW < 1 && (
          <div className="field">
            <span className="muted" style={{ fontSize: 12 }}>Cadrage : place la zone claire sur ton visage</span>
            <div style={{ position: 'relative', width: '100%', aspectRatio: `${media.width} / ${media.height}`, borderRadius: 8, overflow: 'hidden', background: '#000' }}>
              <video
                src={project.ready.proxy ? mediaUrl(project.id, 'proxy.mp4') : mediaUrl(project.id, '__source')}
                muted
                preload="auto"
                onLoadedMetadata={(e) => (e.currentTarget.currentTime = e.currentTarget.duration * 0.3)}
                style={{ width: '100%', height: '100%', display: 'block' }}
              />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${(1 - keepW) * cropX * 100}%`, background: 'rgba(0,0,0,.65)' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${(1 - keepW) * (1 - cropX) * 100}%`, background: 'rgba(0,0,0,.65)' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(1 - keepW) * cropX * 100}%`, width: `${keepW * 100}%`, outline: '2px solid var(--accent)', outlineOffset: -2 }} />
            </div>
            <input type="range" aria-label="Cadrage horizontal" min={0} max={1} step={0.01} value={cropX} onChange={(e) => setCropX(Number(e.target.value))} />
          </div>
        )}
        <div className="field">
          <span className="muted" style={{ fontSize: 12 }}>Résolution</span>
          <div className="seg">
            {options.map((o) => (
              <button key={o} aria-pressed={h === o} onClick={() => setHeight(o)}>
                {vertical ? `${o}×${Math.round((o * 16) / 9)}` : o === 2160 ? '4K' : `${o}p`}
              </button>
            ))}
          </div>
        </div>
        <label className="row">
          <input id="burn" type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} />
          <span>Incruster les sous-titres</span>
        </label>
        <label className="row">
          <input id="srt" type="checkbox" checked={srt} onChange={(e) => setSrt(e.target.checked)} />
          <span>Fichier de sous-titres .srt (YouTube, LinkedIn…)</span>
        </label>
        <p className="muted" style={{ fontSize: 12 }}>
          Rendu depuis le rush original (pas le proxy), avec l’encodeur matériel de ta machine. Les segments déjà rendus pour une version précédente sont réutilisés.
        </p>
        <div className="row">
          <div className="spacer" />
          <button className="btn primary" onClick={() => onExport(version, h, burn, { aspect, cropX, srt })}>Exporter en MP4</button>
        </div>
      </div>
    </div>
  )
}
