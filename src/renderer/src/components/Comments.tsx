import { useEffect, useRef, useState } from 'react'
import { clock } from '../clock'
import { mediaUrl } from '../api'
import { tc, wordAt } from '../../../shared/edl'
import type { Comment, Word } from '../../../shared/types'

export interface Draft {
  t: number
  shapes: number
}

interface Props {
  projectId: string
  comments: Comment[]
  words: Word[]
  draft: Draft | null
  onSubmit: (text: string) => void
  onCancel: () => void
  onDelete: (id: string) => void
  showFixed: boolean
}

export function Comments({ projectId, comments, words, draft, onSubmit, onCancel, onDelete, showFixed }: Props) {
  const [text, setText] = useState('')
  const [near, setNear] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (draft) input.current?.focus()
  }, [draft])

  useEffect(
    () =>
      clock.subscribe((t) => {
        const k = comments.filter((c) => Math.abs(c.t - t) < 1.2).map((c) => c.id).join()
        setNear((prev) => (prev === k ? prev : k))
      }),
    [comments]
  )

  const word = (t: number) => {
    const i = wordAt(words, t)
    return i >= 0 ? words[i].text.replace(/[.,;:!?]$/, '') : ''
  }
  const list = comments.filter((c) => showFixed || !c.fixedIn).sort((a, b) => a.t - b.t)
  const nearSet = new Set(near.split(','))

  return (
    <>
      {draft && (
        <form
          className="draft"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(text.trim())
            setText('')
          }}
        >
          <span className="mono" style={{ color: 'var(--pin)', fontSize: 12 }}>{tc(draft.t)}</span>
          {draft.shapes > 0 && <span className="pill pin">dessin ×{draft.shapes}</span>}
          <input
            ref={input}
            id="comment-draft"
            placeholder="Ce qui doit changer ici…"
            value={text}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setText('')
                onCancel()
              }
            }}
          />
          <button className="btn primary sm" type="submit">Ajouter</button>
        </form>
      )}
      <div className="comments">
        {list.length === 0 && !draft && (
          <p className="muted" style={{ padding: 8 }}>
            Aucun commentaire. Appuie sur <kbd>P</kbd> pour poser un pin au timecode, ou <kbd>D</kbd> pour dessiner sur l’image.
          </p>
        )}
        {list.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            className={`cm${nearSet.has(c.id) ? ' near' : ''}${c.fixedIn ? ' fixed' : ''}`}
            onClick={() => {
              clock.seek(c.t)
              setExpanded(expanded === c.id ? null : c.id)
            }}
            onKeyDown={(e) => e.key === 'Enter' && clock.seek(c.t)}
          >
            <span className="ct">{tc(c.t)}</span>
            <span className="cx">{c.text}</span>
            <button
              className="x"
              aria-label="Supprimer le commentaire"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(c.id)
              }}
            >
              ✕
            </button>
            <span className="meta">
              {c.sketch.length ? <span className="pill pin">dessin</span> : <span className="pill">note</span>}
              {word(c.t) && <span className="pill">« {word(c.t)} »</span>}
              <span className="pill">sur {c.createdIn}</span>
              {c.fixedIn && <span className="pill ok">corrigé en {c.fixedIn}</span>}
            </span>
            {expanded === c.id && c.frame && <img src={mediaUrl(projectId, `comments/${c.frame}`)} alt="Image commentée" />}
          </div>
        ))}
      </div>
    </>
  )
}
