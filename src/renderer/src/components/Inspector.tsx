import { mediaUrl } from '../api'
import type { Chapter, GfxComp, GfxItem, Illustration, Zoom } from '../../../shared/types'

const COMPS: { id: GfxComp; label: string }[] = [
  { id: 'title', label: 'Titre' },
  { id: 'lowerThird', label: 'Lower third' },
  { id: 'list', label: 'Liste' },
  { id: 'callout', label: 'Accroche' },
  { id: 'number', label: 'Chiffre' },
  { id: 'quote', label: 'Citation' },
  { id: 'image', label: 'Image' }
]

interface Props {
  g: GfxItem
  projectId: string
  illustrations: Illustration[]
  onChange: (g: GfxItem) => void
  onDelete: () => void
  onClose: () => void
}

export function Inspector({ g, projectId, illustrations, onChange, onDelete, onClose }: Props) {
  const set = (patch: Partial<GfxItem['props']>) => onChange({ ...g, props: { ...g.props, ...patch } })
  const usesText = g.comp === 'callout' || g.comp === 'quote'
  return (
    <div className="inspector">
      <div className="row">
        <span className="eyebrow">Motion design</span>
        <div className="spacer" />
        <button className="btn sm danger" onClick={onDelete}>Supprimer</button>
        <button className="btn sm ghost" onClick={onClose}>Fermer</button>
      </div>
      <label className="field">
        <span>Composant</span>
        <select id="gfx-comp" className="select" value={g.comp} onChange={(e) => onChange({ ...g, comp: e.target.value as GfxComp })}>
          {COMPS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <div className="grid2">
        <label className="field">
          <span>Début (s)</span>
          <input id="gfx-t" className="input mono" type="number" step="0.1" value={g.t.toFixed(2)} onChange={(e) => onChange({ ...g, t: Math.max(0, Number(e.target.value)) })} />
        </label>
        <label className="field">
          <span>Durée (s)</span>
          <input id="gfx-d" className="input mono" type="number" step="0.1" min="0.5" value={g.d.toFixed(2)} onChange={(e) => onChange({ ...g, d: Math.max(0.5, Number(e.target.value)) })} />
        </label>
      </div>
      {g.comp === 'image' ? (
        <>
          <div className="field">
            <span>Image</span>
            {illustrations.length === 0 ? (
              <p className="muted">Ajoute des images dans l’onglet Style.</p>
            ) : (
              <div className="img-grid">
                {illustrations.map((il) => (
                  <button key={il.file} className="img-tile pick" aria-pressed={g.props.src === il.file} title={il.label} onClick={() => set({ src: il.file })}>
                    <img src={mediaUrl(projectId, `assets/${encodeURIComponent(il.file)}`)} alt={il.label} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="field">
            <span>Mise en page</span>
            <div className="seg">
              <button aria-pressed={g.props.layout !== 'full'} onClick={() => set({ layout: 'card' })}>Carte</button>
              <button aria-pressed={g.props.layout === 'full'} onClick={() => set({ layout: 'full' })}>Plein écran</button>
            </div>
          </div>
          <label className="field">
            <span>Légende (facultatif)</span>
            <input id="gfx-title" className="input" value={g.props.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
          </label>
        </>
      ) : usesText ? (
        <label className="field">
          <span>Texte</span>
          <textarea id="gfx-text" className="textarea" value={g.props.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
        </label>
      ) : (
        <>
          <label className="field">
            <span>{g.comp === 'number' ? 'Chiffre' : 'Titre'}</span>
            <input id="gfx-title" className="input" value={g.props.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
          </label>
          {g.comp !== 'list' && (
            <label className="field">
              <span>{g.comp === 'number' ? 'Légende' : 'Sous-titre'}</span>
              <input id="gfx-subtitle" className="input" value={g.props.subtitle ?? ''} onChange={(e) => set({ subtitle: e.target.value })} />
            </label>
          )}
          {g.comp === 'list' && (
            <label className="field">
              <span>Éléments (un par ligne)</span>
              <textarea id="gfx-items" className="textarea" value={(g.props.items ?? []).join('\n')} onChange={(e) => set({ items: e.target.value.split('\n') })} />
            </label>
          )}
        </>
      )}
    </div>
  )
}

interface ItemProps<T> {
  item: T
  duration: number
  onChange: (item: T) => void
  onDelete: () => void
  onClose: () => void
}

const Head = ({ label, onDelete, onClose }: { label: string; onDelete: () => void; onClose: () => void }) => (
  <div className="row">
    <span className="eyebrow">{label}</span>
    <div className="spacer" />
    <button className="btn sm danger" onClick={onDelete}>Supprimer</button>
    <button className="btn sm ghost" onClick={onClose}>Fermer</button>
  </div>
)

/** Punch-in zoom: strength and timing. Same bounds as the zooms Claude writes. */
export function ZoomInspector({ item: z, duration, onChange, onDelete, onClose }: ItemProps<Zoom>) {
  return (
    <div className="inspector">
      <Head label="Zoom" onDelete={onDelete} onClose={onClose} />
      <label className="field">
        <span>Force · {Math.round(z.scale * 100)} %</span>
        <input id="zoom-scale" type="range" min={1.02} max={1.35} step={0.01} value={z.scale} onChange={(e) => onChange({ ...z, scale: Number(e.target.value) })} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Début (s)</span>
          <input id="zoom-t" className="input mono" type="number" step="0.1" value={z.t.toFixed(2)} onChange={(e) => onChange({ ...z, t: Math.min(duration - z.d, Math.max(0, Number(e.target.value))) })} />
        </label>
        <label className="field">
          <span>Durée (s)</span>
          <input id="zoom-d" className="input mono" type="number" step="0.1" min="0.3" max="8" value={z.d.toFixed(2)} onChange={(e) => onChange({ ...z, d: Math.min(8, Math.max(0.3, Number(e.target.value))) })} />
        </label>
      </div>
      <p className="muted">Glisse le zoom sur la timeline pour le déplacer, ou ses bords pour changer sa durée.</p>
    </div>
  )
}

/** Chapter marker: title and position. */
export function ChapterInspector({ item: c, duration, onChange, onDelete, onClose }: ItemProps<Chapter>) {
  return (
    <div className="inspector">
      <Head label="Chapitre" onDelete={onDelete} onClose={onClose} />
      <label className="field">
        <span>Titre</span>
        <input id="chapter-title" className="input" autoFocus value={c.title} onChange={(e) => onChange({ ...c, title: e.target.value })} />
      </label>
      <label className="field">
        <span>Début (s)</span>
        <input id="chapter-t" className="input mono" type="number" step="0.1" value={c.t.toFixed(2)} onChange={(e) => onChange({ ...c, t: Math.min(duration - 0.01, Math.max(0, Number(e.target.value))) })} />
      </label>
    </div>
  )
}
