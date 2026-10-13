// Everything about how the edit looks, editable live: no regeneration needed.
import { useState } from 'react'
import { api, mediaUrl } from '../api'
import { clock } from '../clock'
import type { Notify } from '../App'
import { CaptionPreview, useLoop } from './Art'
import { CAPTION_STYLES, getTemplate } from '../../../shared/templates'
import { shortTime } from '../../../shared/edl'
import type { DesignSystem, Edl, Illustration, Project } from '../../../shared/types'

interface Props {
  project: Project
  edl: Edl
  ds: DesignSystem
  dsList: DesignSystem[]
  setDsList: (l: DesignSystem[]) => void
  outDur: number
  chapterEnds: number[]
  hasSilences: boolean
  commit: (e: Edl) => void
  cutSilences: () => void
  openBrief: () => void
  notify: Notify
}

export function StylePanel({ project: p, edl, ds, dsList, setDsList, outDur, chapterEnds, hasSilences, commit, cutSilences, openBrief, notify }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const loop = useLoop(2.6)
  const images: Illustration[] = p.illustrations ?? []
  const tpl = getTemplate(p.brief?.template)

  const importDs = async () => {
    setBusy('ds')
    try {
      const d = await api.designSystemFromImage()
      if (d) {
        setDsList(await api.designSystems())
        commit({ ...edl, designSystem: d.id })
      }
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(null)
    }
  }

  const addImages = async () => {
    setBusy('img')
    try {
      await api.addIllustrations(p.id)
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(null)
    }
  }

  const insertImage = (il: Illustration, layout: 'card' | 'full') => {
    const id = `g${Date.now().toString(36)}`
    commit({ ...edl, gfx: [...edl.gfx, { id, t: clock.t, d: 3, comp: 'image' as const, props: { src: il.file, layout, title: '' } }].sort((a, b) => a.t - b.t) })
    notify(`Image ajoutée à ${shortTime(clock.t)}`)
  }

  return (
    <div className="style-pane">
      <section className="sp">
        <div className="sp-h">
          <span className="eyebrow">Brief</span>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={openBrief}>{p.brief?.done ? 'Modifier' : 'Répondre'}</button>
        </div>
        {p.brief?.done ? (
          <p className="sp-brief">
            <b>{p.brief.template === 'reference' ? `Comme « ${p.recipe?.source} »` : tpl?.name}</b>
            {p.brief.audience && <> · {p.brief.audience}</>}
            {p.brief.tone.length > 0 && <span className="muted"> · {p.brief.tone.join(', ')}</span>}
          </p>
        ) : (
          <p className="muted">Quelques questions pour que Claude monte la V1 à ton goût.</p>
        )}
      </section>

      <section className="sp">
        <div className="sp-h">
          <span className="eyebrow">Design system</span>
          <div className="spacer" />
          <button className="btn sm ghost" disabled={busy === 'ds'} onClick={() => void importDs()}>{busy === 'ds' ? 'Analyse…' : '+ Depuis une image'}</button>
        </div>
        <div className="ds-list">
          {dsList.map((d) => (
            <button key={d.id} className="ds-row" aria-pressed={d.id === ds.id} onClick={() => commit({ ...edl, designSystem: d.id })}>
              <span className="sw">
                <i style={{ background: d.bg }} />
                <i style={{ background: d.fg }} />
                <i style={{ background: d.accent }} />
              </span>
              <b style={{ fontFamily: `"${d.font}"` }}>{d.name}</b>
              <span className="muted">{d.note}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="sp">
        <div className="sp-h">
          <span className="eyebrow">Sous-titres</span>
          <div className="spacer" />
          <button className="switch" role="switch" aria-checked={edl.captions.enabled} aria-label="Sous-titres" onClick={() => commit({ ...edl, captions: { ...edl.captions, enabled: !edl.captions.enabled } })}>
            <i />
          </button>
        </div>
        {edl.captions.enabled && (
          <>
            <div className="cap-grid">
              {CAPTION_STYLES.map((c) => (
                <button key={c.id} className="cap-opt" aria-pressed={(edl.captions.style ?? 'karaoke') === c.id} onClick={() => commit({ ...edl, captions: { ...edl.captions, style: c.id } })}>
                  <CaptionPreview style={c.id} ds={ds} t={loop} vertical={false} />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <span className="muted">Mots par groupe</span>
              <div className="spacer" />
              <div className="stepper">
                <button aria-label="Moins" onClick={() => commit({ ...edl, captions: { ...edl.captions, maxWords: Math.max(1, edl.captions.maxWords - 1) } })}>−</button>
                <span className="mono">{edl.captions.maxWords}</span>
                <button aria-label="Plus" onClick={() => commit({ ...edl, captions: { ...edl.captions, maxWords: Math.min(8, edl.captions.maxWords + 1) } })}>+</button>
              </div>
            </div>
            <div className="row">
              <span className="muted">Majuscules</span>
              <div className="spacer" />
              <button className="switch" role="switch" aria-checked={edl.captions.uppercase} aria-label="Majuscules" onClick={() => commit({ ...edl, captions: { ...edl.captions, uppercase: !edl.captions.uppercase } })}>
                <i />
              </button>
            </div>
          </>
        )}
      </section>

      <section className="sp">
        <div className="sp-h">
          <span className="eyebrow">Images d’illustration</span>
          <div className="spacer" />
          <button className="btn sm ghost" disabled={busy === 'img'} onClick={() => void addImages()}>+ Ajouter</button>
        </div>
        {images.length === 0 ? (
          <p className="muted">Ajoute un logo, un produit ou des photos : tu pourras les poser sur la vidéo, et Claude les utilisera dans les prochaines versions.</p>
        ) : (
          <div className="img-grid">
            {images.map((il) => (
              <div key={il.file} className="img-tile" title={il.label}>
                <img src={mediaUrl(p.id, `assets/${encodeURIComponent(il.file)}`)} alt={il.label} />
                <div className="img-actions">
                  <button onClick={() => insertImage(il, 'card')} title="Carte à la tête de lecture">Carte</button>
                  <button onClick={() => insertImage(il, 'full')} title="Plein écran à la tête de lecture">Plein</button>
                </div>
                <button className="x" aria-label="Retirer l’image" onClick={() => void api.removeIllustration(p.id, il.file)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="sp">
        <div className="sp-h">
          <span className="eyebrow">Montage</span>
        </div>
        <div className="stats">
          <div><span className="muted">Brut</span><b className="mono">{shortTime(p.media.duration)}</b></div>
          <div><span className="muted">Monté</span><b className="mono">{shortTime(outDur)}</b></div>
          <div><span className="muted">Plans</span><b className="mono">{edl.keep.length}</b></div>
          <div><span className="muted">Graphismes</span><b className="mono">{edl.gfx.length}</b></div>
        </div>
        <button className="btn sm" disabled={!hasSilences} onClick={cutSilences}>Couper les silences</button>
      </section>

      {edl.chapters.length > 0 && (
        <section className="sp">
          <div className="sp-h"><span className="eyebrow">Séquences</span></div>
          {edl.chapters.map((c, i) => (
            <button key={i} className="chapter" onClick={() => clock.seek(c.t)}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              <span className="t">{c.title}</span>
              <span className="d">{chapterEnds[i].toFixed(1)} s</span>
            </button>
          ))}
        </section>
      )}

      {p.recipe && (
        <section className="sp recipe">
          <span className="eyebrow">Montage copié de</span>
          <span>{p.recipe.source}</span>
          <span className="muted">{p.recipe.summary}</span>
        </section>
      )}
    </div>
  )
}
