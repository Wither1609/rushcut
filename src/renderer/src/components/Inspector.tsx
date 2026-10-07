import type { GfxComp, GfxItem } from '../../../shared/types'

const COMPS: { id: GfxComp; label: string }[] = [
  { id: 'title', label: 'Titre' },
  { id: 'lowerThird', label: 'Lower third' },
  { id: 'list', label: 'Liste' },
  { id: 'callout', label: 'Accroche' },
  { id: 'number', label: 'Chiffre' },
  { id: 'quote', label: 'Citation' }
]

export function Inspector({ g, onChange, onDelete, onClose }: { g: GfxItem; onChange: (g: GfxItem) => void; onDelete: () => void; onClose: () => void }) {
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
      {usesText ? (
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
