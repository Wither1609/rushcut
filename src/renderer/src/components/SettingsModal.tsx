import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Notify } from '../App'
import type { ClaudeAuth, ClaudeCodeStatus, PublicSettings, Settings } from '../../../shared/types'

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommandé)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (plus rapide)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (le plus puissant)' }
]

export function SettingsModal({ settings, onChange, onClose, notify }: { settings: PublicSettings; onChange: (s: PublicSettings) => void; onClose: () => void; notify: Notify }) {
  const [claudeAuth, setAuth] = useState<ClaudeAuth>(settings.claudeAuth)
  const [claudePath, setPath] = useState(settings.claudePath)
  const [cc, setCc] = useState<ClaudeCodeStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [anthropicKey, setA] = useState('')
  const [elevenKey, setE] = useState('')
  const [claudeModel, setModel] = useState(settings.claudeModel)
  const [effort, setEffort] = useState(settings.effort)
  const [scribeModel, setScribe] = useState(settings.scribeModel)

  const check = async () => {
    setChecking(true)
    try {
      // The path typed here is saved first, so the check uses it.
      if (claudePath.trim() !== settings.claudePath) onChange(await api.setSettings({ claudePath: claudePath.trim() }))
      setCc(await api.claudeCodeStatus())
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (claudeAuth === 'subscription' && !cc) void check()
  }, [claudeAuth])

  const save = async () => {
    const patch: Partial<Settings> = { claudeAuth, claudePath: claudePath.trim(), claudeModel, effort, scribeModel }
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
        <div className="field">
          <span>Connexion à Claude</span>
          <div className="seg">
            <button aria-pressed={claudeAuth === 'subscription'} onClick={() => setAuth('subscription')}>Mon abonnement Claude</button>
            <button aria-pressed={claudeAuth === 'api'} onClick={() => setAuth('api')}>Clé API</button>
          </div>
        </div>
        {claudeAuth === 'subscription' ? (
          <div className="field">
            <span>
              Claude Code{' '}
              {checking ? (
                <b className="pill">vérification…</b>
              ) : cc?.installed && cc.loggedIn ? (
                <b className="pill ok">connecté{cc.plan ? ` · ${cc.plan}` : ''}{cc.email ? ` · ${cc.email}` : ''}</b>
              ) : cc?.installed ? (
                <b className="pill pin">non connecté</b>
              ) : cc ? (
                <b className="pill pin">introuvable</b>
              ) : null}
            </span>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              Le montage passe par Claude Code, connecté à ton abonnement Pro ou Max : pas de clé API, l’usage compte dans les limites de ton abonnement.
              {cc && !cc.installed && <> Installe Claude Code (claude.com/claude-code), puis connecte-toi.</>}
              {cc?.installed && !cc.loggedIn && <> Dans un terminal, lance <code>claude auth login</code>, puis clique sur Vérifier.</>}
            </p>
            <div className="row">
              <input id="claudePath" className="input mono" placeholder={cc?.path ?? 'Chemin de claude (détecté automatiquement)'} value={claudePath} onChange={(e) => setPath(e.target.value)} />
              <button className="btn" disabled={checking} onClick={() => void check()}>Vérifier</button>
            </div>
          </div>
        ) : (
          <label className="field">
            <span>Clé API Claude (Anthropic) {settings.hasAnthropicKey && <b className="pill ok">enregistrée</b>}</span>
            <input id="anthropicKey" className="input mono" type="password" placeholder={settings.hasAnthropicKey ? '•••••••• (laisser vide pour garder)' : 'sk-ant-…'} value={anthropicKey} onChange={(e) => setA(e.target.value)} />
          </label>
        )}
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
