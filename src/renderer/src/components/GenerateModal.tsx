import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Notify } from '../App'
import type { DesignSystem, Project } from '../../../shared/types'

interface Props {
  project: Project
  base: string
  nextName: string
  openComments: number
  onClose: () => void
  onGenerate: (dsId: string) => void
  notify: Notify
}

export function DsPreview({ ds }: { ds: DesignSystem }) {
  return (
    <div className="mini">
      <span style={{ position: 'absolute', top: '10%', right: '6%', fontSize: 9, padding: '2px 6px', borderRadius: 999, background: ds.accent, color: ds.bg, fontFamily: `"${ds.font}"`, fontWeight: ds.weight }}>01</span>
      <div
        style={{
          position: 'absolute',
          left: '8%',
          bottom: '14%',
          padding: '6px 10px 6px 12px',
          borderRadius: Math.min(ds.radius, 10) / 2,
          background: ds.bg,
          color: ds.fg,
          fontFamily: `"${ds.font}", sans-serif`,
          fontWeight: ds.weight,
          fontSize: 15,
          lineHeight: 1.1,
          borderLeft: `4px solid ${ds.accent}`
        }}
      >
        Titre de séquence
        <small style={{ display: 'block', fontSize: 9, opacity: 0.75, marginTop: 3, fontFamily: 'Figtree', fontWeight: 500 }}>sous-titre</small>
      </div>
    </div>
  )
}

export function GenerateModal({ project, base, nextName, openComments, onClose, onGenerate, notify }: Props) {
  const [list, setList] = useState<DesignSystem[]>([])
  const [ds, setDs] = useState(project.designSystem)
  const [notes, setNotes] = useState(project.notes)
  const [recipe, setRecipe] = useState(project.recipe)
  const [busy, setBusy] = useState<string | null>(null)
  const first = base === 'V0'

  useEffect(() => void api.designSystems().then(setList), [])

  const importDs = async () => {
    setBusy('ds')
    try {
      const d = await api.designSystemFromImage()
      if (d) {
        setList(await api.designSystems())
        setDs(d.id)
        notify(`Design system « ${d.name} » créé`)
      }
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(null)
    }
  }

  const reference = async () => {
    setBusy('ref')
    try {
      const r = await api.reference(project.id)
      if (r) setRecipe(r)
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(null)
    }
  }

  const go = async () => {
    await api.updateProject(project.id, { notes, designSystem: ds })
    onGenerate(ds)
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={`Générer ${nextName}`}>
        <div className="modal-h">
          <h2>Générer {nextName}</h2>
          <span className="pill">{first ? 'premier montage depuis le transcript' : `depuis ${base} · ${openComments} commentaire${openComments > 1 ? 's' : ''} ouvert${openComments > 1 ? 's' : ''}`}</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Fermer</button>
        </div>

        <div className="col">
          <span className="eyebrow">Design system</span>
          <div className="ds-grid">
            {list.map((d) => (
              <button key={d.id} className="ds" aria-pressed={d.id === ds} onClick={() => setDs(d.id)}>
                <DsPreview ds={d} />
                <div className="row">
                  <b>{d.name}</b>
                  <div className="spacer" />
                  <span className="muted" style={{ fontSize: 11 }}>{d.note}</span>
                </div>
                <div className="row">
                  <div className="sw">
                    <i style={{ background: d.bg }} />
                    <i style={{ background: d.fg }} />
                    <i style={{ background: d.accent }} />
                  </div>
                  <div className="spacer" />
                  {!d.builtin && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="muted"
                      style={{ fontSize: 11 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        void api.deleteDesignSystem(d.id).then(setList)
                      }}
                    >
                      retirer
                    </span>
                  )}
                </div>
              </button>
            ))}
            <button className="ds import" onClick={() => void importDs()} disabled={busy === 'ds'}>
              <div className="mini">{busy === 'ds' ? 'Claude analyse l’image…' : 'Importer depuis une capture, un deck ou un site. Claude extrait couleurs, police et arrondis.'}</div>
              <b>+ Nouveau</b>
            </button>
          </div>
        </div>

        {first && (
          <div className="col">
            <span className="eyebrow">Copier le montage d’une vidéo d’exemple</span>
            {recipe ? (
              <div className="recipe" style={{ background: 'var(--panel-2)', padding: 10, borderRadius: 8 }}>
                <div className="row">
                  <b>EXEMPLE</b> <span>{recipe.source}</span>
                  <span className="pill">plan moyen {recipe.avgShot.toFixed(1)} s</span>
                  <div className="spacer" />
                  <button className="btn sm ghost" onClick={() => void api.updateProject(project.id, { recipe: undefined }).then(() => setRecipe(undefined))}>Retirer</button>
                </div>
                <span><b>RYTHME </b>{recipe.rhythm}</span>
                <span><b>ZOOMS </b>{recipe.zooms}</span>
                <span><b>SOUS-TITRES </b>{recipe.captions}</span>
                <span><b>GRAPHISMES </b>{recipe.graphics}</span>
                <span><b>STRUCTURE </b>{recipe.structure}</span>
              </div>
            ) : (
              <div className="row">
                <p className="muted" style={{ flex: 1 }}>Choisis une vidéo dont tu aimes le montage : Rushcut en tire le rythme, les zooms, le style des sous-titres et des graphismes, et Claude l’applique à ton rush.</p>
                <button className="btn" disabled={busy === 'ref'} onClick={() => void reference()}>{busy === 'ref' ? 'Analyse…' : 'Choisir une vidéo d’exemple'}</button>
              </div>
            )}
          </div>
        )}

        <label className="field">
          <span>Consignes pour Claude (ton, public, ce qu’il faut garder ou couper)</span>
          <textarea id="notes" className="textarea" value={notes} placeholder="Ex. : vidéo YouTube pour débutants, garder les blagues, titres courts, pas de zoom sur la démo écran." onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="row">
          <span className="muted" style={{ fontSize: 12 }}>Claude écrit un fichier de montage : aucun rendu vidéo n’est lancé, l’aperçu est immédiat.</span>
          <div className="spacer" />
          <button className="btn primary" disabled={!!busy} onClick={() => void go()}>✦ Générer {nextName}</button>
        </div>
      </div>
    </div>
  )
}
