import { memo, useEffect, useMemo, useRef } from 'react'
import { clock } from '../clock'
import { keepIndexAt, wordAt } from '../../../shared/edl'
import type { Range, Word } from '../../../shared/types'

interface Props {
  words: Word[]
  keep: Range[]
  sel: [number, number] | null
  onSelect: (sel: [number, number] | null) => void
  emptyHint: React.ReactNode
}

/** Word-level transcript. The spoken word follows the playhead; drag across words to select them. */
export const Transcript = memo(function Transcript({ words, keep, sel, onSelect, emptyHint }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const spans = useRef<HTMLElement[]>([])
  const drag = useRef<{ a: number; b: number; moved: boolean } | null>(null)

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
  }, [paras, cutSet, sel])

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
  }, [words, paras, cutSet, sel])

  if (!words.length) return <div className="script">{emptyHint}</div>

  const idx = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.w')
    return el ? Number(el.dataset.i) : -1
  }
  const [s0, s1] = sel ? [Math.min(...sel), Math.max(...sel)] : [-1, -1]

  return (
    <div
      className="script"
      ref={box}
      onMouseDown={(e) => {
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
              <span data-i={i} className={`w${cutSet[i] ? ' cut' : ''}${i >= s0 && i <= s1 ? ' sel' : ''}`}>
                {words[i].text}
              </span>{' '}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
})
