import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { clock } from '../clock'
import { keepIndexAt, wordAt } from '../../../shared/edl'
import { editWord, findWord, replaceWord } from '../../../shared/transcript'
import type { Range, Word } from '../../../shared/types'

interface Props {
  words: Word[]
  keep: Range[]
  sel: [number, number] | null
  onSelect: (sel: [number, number] | null) => void
  /** A corrected transcript (same timings, new text). */
  onChange: (words: Word[]) => void
  emptyHint: React.ReactNode
}

/** Word-level transcript. The spoken word follows the playhead; drag across words to select them, double-click one to correct it. */
export const Transcript = memo(function Transcript({ words, keep, sel, onSelect, onChange, emptyHint }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const spans = useRef<HTMLElement[]>([])
  const drag = useRef<{ a: number; b: number; moved: boolean } | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [repl, setRepl] = useState('')
  const hits = useMemo(() => findWord(words, query), [words, query])
  const hitSet = useMemo(() => new Set(hits), [hits])

  /** End of an inline correction. `move` goes on to the next (1) or previous (-1) word, for proofreading with Tab. */
  const finishEdit = (i: number, text: string | null, move: 0 | 1 | -1) => {
    let next = words
    if (text !== null) {
      next = editWord(words, i, text)
      if (next !== words) onChange(next)
    }
    // A word typed as several (or removed) shifts the ones after it.
    const after = i + (next.length - words.length) + 1
    const to = move === 1 ? after : move === -1 ? i - 1 : -1
    setEditing(to >= 0 && to < next.length ? to : null)
  }

  /** Enter in the search box: jump to the next occurrence after the playhead. */
  const nextHit = () => {
    if (!hits.length) return
    const i = hits.find((k) => words[k].start > clock.t + 0.01) ?? hits[0]
    clock.seek(words[i].start + 0.001)
    spans.current[i]?.scrollIntoView({ block: 'center' })
  }

  const replaceAll = () => {
    const r = replaceWord(words, query, repl)
    if (r.count) onChange(r.words)
    setQuery(repl.trim())
    setRepl('')
  }

  // Paragraphs break on sentence ends followed by a pause.
  const paras = useMemo(() => {
    const out: number[][] = []
    let cur: number[] = []
    words.forEach((w, i) => {
      cur.push(i)
      const next = words[i + 1]
      if (!next || (/[.?!…]$/.test(w.text) && next.start - w.end > 0.8) || cur.length > 90) {
        out.push(cur)
        cur = []
      }
    })
    return out
  }, [words])

  const cutSet = useMemo(() => words.map((w) => keepIndexAt(keep, (w.start + w.end) / 2) < 0), [words, keep])

  useEffect(() => {
    spans.current = Array.from(box.current?.querySelectorAll<HTMLElement>('.w') ?? [])
  }, [paras, cutSet, sel, editing, hitSet])

  // Imperative highlight: no React render per word.
  useEffect(() => {
    let last = -2
    const update = (t: number) => {
      const i = wordAt(words, t)
      const now = i >= 0 && t <= words[i].end + 0.25 ? i : -1
      if (now === last) return
      const els = spans.current
      const lo = Math.min(last, i)
      const hi = Math.max(last, i)
      if (Math.abs(i - last) > 400 || last < 0) els.forEach((el, k) => el.classList.toggle('past', k < i))
      else for (let k = Math.max(0, lo); k <= hi && k < els.length; k++) els[k].classList.toggle('past', k < i)
      if (last >= 0) els[last]?.classList.remove('now')
      if (now >= 0) {
        const el = els[now]
        el?.classList.add('now')
        const b = box.current
        if (el && b && clock.playing) {
          const top = el.offsetTop - b.offsetTop
          if (top < b.scrollTop + 20 || top > b.scrollTop + b.clientHeight - 50) b.scrollTop = top - b.clientHeight / 3
        }
      }
      last = now >= 0 ? now : i
    }
    update(clock.t)
    return clock.subscribe(update)
  }, [words, paras, cutSet, sel, editing, hitSet])

  if (!words.length) return <div className="script">{emptyHint}</div>

  const idx = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.w')
    return el ? Number(el.dataset.i) : -1
  }
  const [s0, s1] = sel ? [Math.min(...sel), Math.max(...sel)] : [-1, -1]
  const inInput = (e: React.MouseEvent) => (e.target as HTMLElement).tagName === 'INPUT'

  return (
    <>
    <div className="find" role="search">
      <input
        id="transcript-find"
        className="input"
        placeholder="Rechercher un mot…"
        aria-label="Rechercher un mot dans le transcript"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') nextHit()
          else if (e.key === 'Escape') setQuery('')
        }}
      />
      {query.trim() && (
        <>
          <span className="find-count mono">{hits.length}</span>
          <input
            id="transcript-replace"
            className="input"
            placeholder="Remplacer par…"
            aria-label="Remplacer par"
            value={repl}
            onChange={(e) => setRepl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && hits.length > 0 && repl.trim() && replaceAll()}
          />
          <button className="btn sm" disabled={!hits.length || !repl.trim()} onClick={replaceAll} title="Corriger toutes les occurrences dans le transcript, les sous-titres et le .srt">
            Tout remplacer
          </button>
        </>
      )}
    </div>
    <div
      className="script"
      ref={box}
      onMouseDown={(e) => {
        if (inInput(e)) return
        const i = idx(e)
        if (i < 0) return onSelect(null)
        drag.current = { a: i, b: i, moved: false }
      }}
      onMouseOver={(e) => {
        const d = drag.current
        const i = idx(e)
        if (!d || i < 0 || i === d.b) return
        d.b = i
        d.moved = true
        onSelect([d.a, d.b])
      }}
      onMouseUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d) return
        if (!d.moved) {
          // A plain click jumps to the word.
          onSelect(e.shiftKey && sel ? [sel[0], d.a] : null)
          if (!e.shiftKey) clock.seek(words[d.a].start + 0.001)
        }
      }}
    >
      {paras.map((p, k) => (
        <p className="para" key={k}>
          {p.map((i) => (
            <span key={i}>
              <span
                data-i={i}
                className={`w${cutSet[i] ? ' cut' : ''}${i >= s0 && i <= s1 ? ' sel' : ''}${hitSet.has(i) ? ' hit' : ''}${editing === i ? ' editing' : ''}`}
                title={editing === i ? undefined : 'Double-clic pour corriger'}
                onDoubleClick={() => setEditing(i)}
              >
                {editing === i ? <WordInput key={i} value={words[i].text} onDone={(t, m) => finishEdit(i, t, m)} /> : words[i].text}
              </span>{' '}
            </span>
          ))}
        </p>
      ))}
    </div>
    </>
  )
})

/** Inline correction of one word. Enter keeps, Escape drops, Tab / Shift+Tab keep and move on, clicking away keeps. */
function WordInput({ value, onDone }: { value: string; onDone: (text: string | null, move: 0 | 1 | -1) => void }) {
  const done = useRef(false)
  const finish = (text: string | null, move: 0 | 1 | -1) => {
    if (done.current) return
    done.current = true
    onDone(text, move)
  }
  return (
    <input
      className="w-edit"
      aria-label="Corriger le mot"
      autoFocus
      defaultValue={value}
      size={Math.max(3, value.length + 1)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => (e.currentTarget.size = Math.max(3, e.currentTarget.value.length + 1))}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value, 0)
        else if (e.key === 'Escape') finish(null, 0)
        else if (e.key === 'Tab') {
          e.preventDefault()
          finish(e.currentTarget.value, e.shiftKey ? -1 : 1)
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value, 0)}
    />
  )
}
