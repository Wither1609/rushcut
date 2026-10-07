import { useEffect, useState } from 'react'
import { api, mediaUrl } from './api'
import { Logo, type Notify } from './App'
import { shortTime } from '../../shared/edl'
import type { Project, PublicSettings } from '../../shared/types'

export function Home({ onOpen, openSettings, notify, settings }: { onOpen: (id: string) => void; openSettings: () => void; notify: Notify; settings: PublicSettings | null }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [over, setOver] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => void api.projects().then(setProjects).catch((e) => notify(e.message, true))
  useEffect(() => {
    refresh()
    return window.rushcut.on('project-updated', refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.projectsDir])

  const create = async (file?: string) => {
    setBusy(true)
    try {
      const p = await api.createProject(file)
      if (p) onOpen(p.id)
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className={`topbar${window.rushcut.platform === 'darwin' ? ' mac' : ''}`}>
        <div className="brand">
          <Logo />
          <b>Rushcut</b>
        </div>
        <span className="crumb">Projets</span>
        <div className="spacer" />
        <button className="btn ghost" onClick={openSettings}>Réglages</button>
      </header>
      <main className="home">
        <div className="home-inner">
          <div
            className={`drop${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files[0]
              if (f) void create(window.rushcut.pathForFile(f))
            }}
          >
            <div className="col" style={{ flex: 1 }}>
              <h2>Nouveau montage</h2>
              <p className="muted">
                Glisse un rush ici. Rushcut prépare un proxy léger, la forme d’onde et le transcript mot à mot, puis Claude monte la V1.
              </p>
            </div>
            <button className="btn primary" disabled={busy} onClick={() => void create()}>
              {busy ? 'Analyse du fichier…' : 'Choisir une vidéo'}
            </button>
          </div>

          <div className="row">
            <span className="eyebrow">Projets</span>
            <span className="pill">{projects.length}</span>
            <div className="spacer" />
            <span className="muted mono" style={{ fontSize: 11 }}>{settings?.projectsDir}</span>
          </div>

          {projects.length === 0 ? (
            <div className="empty">Aucun projet pour l’instant. Ton premier rush apparaîtra ici.</div>
          ) : (
            <div className="cards">
              {projects.map((p) => (
                <div key={p.id} className="card">
                  <button
                    className="thumb"
                    style={{
                      border: 'none',
                      backgroundImage: p.sprite ? `url("${mediaUrl(p.id, p.sprite.file)}")` : undefined,
                      backgroundSize: p.sprite ? `${p.sprite.cols * 100}% auto` : undefined,
                      backgroundPosition: '0 0'
                    }}
                    onClick={() => onOpen(p.id)}
                    aria-label={`Ouvrir ${p.name}`}
                  >
                    {!p.sprite && 'Préparation…'}
                  </button>
                  <div className="meta">
                    <b>{p.name}</b>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <span className="pill mono">{shortTime(p.media.duration)}</span>
                      <span className="pill">{p.media.width}×{p.media.height}</span>
                      <span className="pill accent">{p.versions.filter((v) => v !== 'V0').length} version(s)</span>
                      {!p.ready.transcript && <span className="pill">sans transcript</span>}
                    </div>
                    <div className="row">
                      <span className="muted" style={{ fontSize: 11 }}>{new Date(p.createdAt).toLocaleDateString('fr-FR')}</span>
                      <div className="spacer" />
                      {confirmDel === p.id ? (
                        <>
                          <button className="btn sm danger" onClick={() => void api.deleteProject(p.id).then(refresh)}>Supprimer</button>
                          <button className="btn sm ghost" onClick={() => setConfirmDel(null)}>Annuler</button>
                        </>
                      ) : (
                        <>
                          <button className="btn sm ghost" onClick={() => void api.revealProject(p.id)}>Dossier</button>
                          <button className="btn sm ghost" onClick={() => setConfirmDel(p.id)}>Supprimer</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
