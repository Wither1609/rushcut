import { useEffect, useState } from 'react'
import { api, mediaUrl } from './api'
import { Logo, type Notify } from './App'
import { shortTime } from '../../shared/edl'
import { getTemplate } from '../../shared/templates'
import type { Project, PublicSettings } from '../../shared/types'

/** A frame from the filmstrip, shown at the video's own aspect ratio over a blurred copy of itself. */
function Thumb({ p }: { p: Project }) {
  const s = p.sprite
  if (!s) {
    return (
      <div className="thumb empty-thumb">
        <span className="spin sm" /> Préparation…
      </div>
    )
  }
  const rows = Math.ceil(s.count / s.cols)
  const i = Math.min(s.count - 1, Math.floor(s.count / 3))
  const x = s.cols > 1 ? ((i % s.cols) / (s.cols - 1)) * 100 : 0
  const y = rows > 1 ? (Math.floor(i / s.cols) / (rows - 1)) * 100 : 0
  const bg = { backgroundImage: `url("${mediaUrl(p.id, s.file)}")`, backgroundSize: `${s.cols * 100}% ${rows * 100}%`, backgroundPosition: `${x}% ${y}%` }
  return (
    <div className="thumb">
      <i className="blur" style={bg} />
      <i className="frame-img" style={{ ...bg, aspectRatio: `${p.media.width} / ${p.media.height}` }} />
    </div>
  )
}

function status(p: Project): { label: string; tone: '' | 'accent' | 'ok' } {
  const n = p.versions.filter((v) => v !== 'V0').length
  if (!n) return { label: p.brief?.done ? 'Brief prêt' : 'Brut', tone: '' }
  return { label: `${p.current && p.current !== 'V0' ? p.current : 'V' + n} · ${n} version${n > 1 ? 's' : ''}`, tone: 'accent' }
}

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
        <div className="spacer" />
        <button className="btn ghost" onClick={openSettings}>Réglages</button>
      </header>
      <main
        className={`home${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) void create(window.rushcut.pathForFile(f))
        }}
      >
        <div className="home-inner">
          <section className="hero">
            <div className="hero-txt">
              <h1>
                Du rush à la V1,
                <br />
                <em>sans timeline à la main.</em>
              </h1>
              <p className="muted">Dépose une vidéo. Rushcut la transcrit, te pose quelques questions sur le style voulu, puis Claude monte une première version que tu corriges en commentant.</p>
              <div className="row" style={{ gap: 12 }}>
                <button className="btn primary lg" disabled={busy} onClick={() => void create()}>
                  {busy ? 'Analyse du fichier…' : 'Choisir une vidéo'}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>ou glisse-la n’importe où dans la fenêtre</span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="ha-frame">
                <span className="ha-cap">
                  <b>ÇA</b> <b className="on">CHANGE</b> <b>TOUT</b>
                </span>
                <span className="ha-title">Partie 1</span>
              </div>
              <div className="ha-track">
                {[38, 22, 46, 18, 30, 26, 40].map((w, i) => (
                  <i key={i} style={{ flex: w, animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
            </div>
          </section>

          {projects.length > 0 && (
            <>
              <div className="row section-h">
                <h2>Projets</h2>
                <span className="muted">{projects.length}</span>
                <div className="spacer" />
                <button className="link mono" onClick={() => void api.pickProjectsDir().then(() => refresh())} title="Changer de dossier">{settings?.projectsDir}</button>
              </div>
              <div className="cards">
                {projects.map((p, k) => {
                  const st = status(p)
                  const tpl = getTemplate(p.brief?.template)
                  return (
                    <div key={p.id} className="card" style={{ ['--i' as string]: k }}>
                      <button className="card-open" onClick={() => onOpen(p.id)} aria-label={`Ouvrir ${p.name}`}>
                        <Thumb p={p} />
                        <span className="dur mono">{shortTime(p.media.duration)}</span>
                      </button>
                      <div className="meta">
                        <b title={p.name}>{p.name}</b>
                        <div className="row muted sub">
                          <span className={`dot ${st.tone}`} />
                          <span>{st.label}</span>
                          {tpl && <span>· {tpl.name}</span>}
                          <div className="spacer" />
                          <span>{new Date(p.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                        </div>
                      </div>
                      <div className="card-menu">
                        {confirmDel === p.id ? (
                          <>
                            <button className="btn sm danger" onClick={() => void api.deleteProject(p.id).then(refresh)}>Supprimer</button>
                            <button className="btn sm" onClick={() => setConfirmDel(null)}>Annuler</button>
                          </>
                        ) : (
                          <>
                            <button className="btn sm" onClick={() => void api.revealProject(p.id)}>Dossier</button>
                            <button className="btn sm" onClick={() => setConfirmDel(p.id)}>Supprimer</button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
        {over && (
          <div className="drop-veil">
            <div>Dépose pour créer un projet</div>
          </div>
        )}
      </main>
    </>
  )
}
