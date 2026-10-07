import { useState } from 'react'
import { api } from '../api'
import type { Notify } from '../App'
import type { PublicSettings, Settings } from '../../../shared/types'

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommandé)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (plus rapide)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (le plus puissant)' }
]

export function SettingsModal({ settings, onChange, onClose, notify }: { settings: PublicSettings; onChange: (s: PublicSettings) => void; onClose: () => void; notify: Notify }) {
  const [anthropicKey, setA] = useState('')
  const [elevenKey, setE] = useState('')
  const [claudeModel, setModel] = useState(settings.claudeModel)
  const [effort, setEffort] = useState(settings.effort)
  const [scribeModel, setScribe] = useState(settings.scribeModel)

  const save = async () => {
    const patch: Partial<Settings> = { claudeModel, effort, scribeModel }
    if (anthropicKey.trim()) patch.anthropicKey = anthropicKey.trim()
    if (elevenKey.trim()) patch.elevenKey = elevenKey.trim()
    try {
      onChange(await api.setSettings(patch))
      notify('Réglages enregistrés')
      onClose()
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sm" role="dialog" aria-label="Réglages">
        <div className="modal-h">
          <h2>Réglages</h2>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Fermer</button>
        </div>

        <span className="eyebrow">Connecteurs</span>
        <label className="field">
          <span>Clé API Claude (Anthropic) {settings.hasAnthropicKey && <b className="pill ok">enregistrée</b>}</span>
          <input id="anthropicKey" className="input mono" type="password" placeholder={settings.hasAnthropicKey ? '•••••••• (laisser vide pour garder)' : 'sk-ant-…'} value={anthropicKey} onChange={(e) => setA(e.target.value)} />
        </label>
        <label className="field">
          <span>Clé API ElevenLabs {settings.hasElevenKey && <b className="pill ok">enregistrée</b>}</span>
          <input id="elevenKey" className="input mono" type="password" placeholder={settings.hasElevenKey ? '•••••••• (laisser vide pour garder)' : 'clé xi-api-key'} value={elevenKey} onChange={(e) => setE(e.target.value)} />
        </label>
        <p className="muted" style={{ fontSize: 12 }}>Les clés sont chiffrées avec le trousseau du système (Keychain sur Mac, DPAPI sur Windows) et ne quittent pas ton ordinateur, sauf vers l’API concernée.</p>

        <span className="eyebrow">Montage</span>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label className="field" style={{ flex: 2 }}>
            <span>Modèle Claude</span>
            <select id="claudeModel" className="select" value={claudeModel} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Effort</span>
            <select id="effort" className="select" value={effort} onChange={(e) => setEffort(e.target.value as Settings['effort'])}>
              <option value="low">Bas</option>
              <option value="medium">Moyen</option>
              <option value="high">Élevé</option>
              <option value="xhigh">Très élevé</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Modèle de transcription ElevenLabs</span>
          <input id="scribeModel" className="input mono" value={scribeModel} onChange={(e) => setScribe(e.target.value)} />
        </label>
        <label className="field">
          <span>Dossier des projets</span>
          <div className="row">
            <input className="input mono" readOnly value={settings.projectsDir} />
            <button className="btn" onClick={() => void api.pickProjectsDir().then((s) => s && onChange(s))}>Changer</button>
          </div>
        </label>
        <div className="row">
          <div className="spacer" />
          <button className="btn primary" onClick={() => void save()}>Enregistrer</button>
        </div>
      </div>
    </div>
  )
}
