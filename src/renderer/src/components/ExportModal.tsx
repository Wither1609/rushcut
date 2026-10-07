import { useState } from 'react'
import type { Project } from '../../../shared/types'

interface Props {
  project: Project
  versions: string[]
  current: string
  onClose: () => void
  onExport: (v: string, height: 720 | 1080 | 2160, burn: boolean) => void
}

export function ExportModal({ project, versions, current, onClose, onExport }: Props) {
  const [version, setVersion] = useState(current)
  const options = ([720, 1080, 2160] as const).filter((h) => h <= Math.max(720, project.media.height))
  const [height, setHeight] = useState<720 | 1080 | 2160>(options.includes(1080) ? 1080 : options[options.length - 1])
  const [burn, setBurn] = useState(true)

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
          <span className="muted" style={{ fontSize: 12 }}>Résolution</span>
          <div className="seg">
            {options.map((h) => (
              <button key={h} aria-pressed={height === h} onClick={() => setHeight(h)}>{h === 2160 ? '4K' : `${h}p`}</button>
            ))}
          </div>
        </div>
        <label className="row">
          <input id="burn" type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} />
          <span>Incruster les sous-titres</span>
        </label>
        <p className="muted" style={{ fontSize: 12 }}>
          Rendu depuis le rush original (pas le proxy), avec l’encodeur matériel de ta machine. Les segments déjà rendus pour une version précédente sont réutilisés.
        </p>
        <div className="row">
          <div className="spacer" />
          <button className="btn primary" onClick={() => onExport(version, height, burn)}>Exporter en MP4</button>
        </div>
      </div>
    </div>
  )
}
