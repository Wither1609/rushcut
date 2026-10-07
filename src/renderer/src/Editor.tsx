import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { clock } from './clock'
import type { Notify } from './App'
import { Player, Timecode, type PlayerHandle } from './components/Player'
import { Transcript } from './components/Transcript'
import { Comments, type Draft } from './components/Comments'
import { Timeline, type Selection } from './components/Timeline'
import { ChapterInspector, Inspector, ZoomInspector } from './components/Inspector'
import { GenerateModal } from './components/GenerateModal'
import { ExportModal } from './components/ExportModal'
import { Onboarding } from './components/Onboarding'
import { StylePanel } from './components/StylePanel'
import { cutRange, editedDuration, keepIndexAt, restoreRange, shortTime, splitAt, srcToOut } from '../../shared/edl'
import { buildChunks } from '../../shared/overlay'
import { BUILTIN_DS, type Chapter, type Comment, type DesignSystem, type Edl, type ExportOptions, type JobState, type ProjectBundle, type Shape, type Zoom } from '../../shared/types'

interface Props {
  projectId: string
  onClose: () => void
  openSettings: () => void
  notify: Notify
  jobs: JobState[]
}

type Tab = 'transcript' | 'comments' | 'style'

export const Ic = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const I = {
  back: 'M15 18l-6-6 6-6',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 1112 0c0 5.5-6 11-6 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  draw: 'M4 20l4-1 10.5-10.5a2.1 2.1 0 00-3-3L5 16l-1 4zM14 7l3 3',
  cut: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  check: 'M5 12.5l4.5 4.5L19 7.5'
}

const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
  </svg>
)
const PauseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" />
  </svg>
)

export function Editor({ projectId, onClose, openSettings, notify, jobs }: Props) {
  const [b, setB] = useState<ProjectBundle | null>(null)
  const [dsList, setDsList] = useState<DesignSystem[]>(BUILTIN_DS)
  const [selection, setSelection] = useState<Selection>(null)
  const [drawMode, setDrawMode] = useState(false)
  const [draft, setDraft] = useState<(Draft & { sketch: Shape[] }) | null>(null)
  const [modal, setModal] = useState<'generate' | 'export' | null>(null)
  const [onboarding, setOnboarding] = useState(false)
  const [tab, setTab] = useState<Tab>('transcript')
  const [skipCuts, setSkipCuts] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [pps, setPps] = useState(20)
  const [showFixed, setShowFixed] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [playing, setPlaying] = useState(false)
  const player = useRef<PlayerHandle>(null)
  const undo = useRef<Edl[]>([])
  const redo = useRef<Edl[]>([])

  const reload = useCallback(async () => {
    try {
      setB(await api.bundle(projectId))
    } catch (e) {
      notify((e as Error).message, true)
    }
  }, [projectId, notify])

  useEffect(() => {
    void reload().then(() => clock.set(0))
    void api.designSystems().then(setDsList)
    return window.rushcut.on('project-updated', (id) => id === projectId && void reload())
  }, [projectId, reload])

  useEffect(() => clock.onPlaying(setPlaying), [])

  // Fit the whole raw in the timeline on first load, and greet a brand-new project with the questions.
  const fitted = useRef(false)
  useEffect(() => {
    if (b && !fitted.current) {
      fitted.current = true
      setPps(Math.max(1, (window.innerWidth - 80) / b.project.media.duration))
      if (b.project.versions.length === 1 && !b.project.brief?.done) setOnboarding(true)
    }
  }, [b])

  const version = b?.project.current ?? 'V0'
  const edl = b?.edls[version] ?? null
  const ds = dsList.find((d) => d.id === edl?.designSystem) ?? BUILTIN_DS[0]
  const chunks = useMemo(() => (b && edl ? buildChunks(b.words, edl.keep, edl.captions.maxWords) : []), [b, edl])
  const openComments = useMemo(() => (b ? b.comments.filter((c) => !c.fixedIn) : []), [b])
  const projectJobs = jobs.filter((j) => j.status !== 'done')

  // ---- edits -----------------------------------------------------------------
  const commit = useCallback(
    (next: Edl, record = true) => {
      if (!b) return
      const prev = b.edls[next.version]
      if (record && prev) {
        undo.current.push(prev)
        if (undo.current.length > 200) undo.current.shift()
        redo.current = []
      }
      setB({ ...b, edls: { ...b.edls, [next.version]: next } })
      void api.saveEdl(projectId, next).catch((e) => notify(e.message, true))
    },
    [b, projectId, notify]
  )

  const doUndo = useCallback(
    (back: boolean) => {
      if (!edl) return
      const from = back ? undo.current : redo.current
      const to = back ? redo.current : undo.current
      const e = from.pop()
      if (!e || e.version !== edl.version) return
      to.push(edl)
      commit(e, false)
    },
    [edl, commit]
  )

  const saveComments = useCallback(
    (list: Comment[]) => {
      if (!b) return
      setB({ ...b, comments: list })
      void api.saveComments(projectId, list).catch((e) => notify(e.message, true))
    },
    [b, projectId, notify]
  )

  const deleteSelection = useCallback(() => {
    if (!b || !edl || !selection) return
    const D = b.project.media.duration
    if (selection.kind === 'clip') {
      const r = edl.keep[selection.index]
      if (r) commit({ ...edl, keep: cutRange(edl.keep, r.in, r.out) })
    } else if (selection.kind === 'gap') {
      commit({ ...edl, keep: restoreRange(edl.keep, selection.a, selection.b, D) })
    } else if (selection.kind === 'gfx') {
      commit({ ...edl, gfx: edl.gfx.filter((g) => g.id !== selection.id) })
    } else if (selection.kind === 'zoom') {
      commit({ ...edl, zooms: edl.zooms.filter((_, i) => i !== selection.index) })
    } else if (selection.kind === 'chapter') {
      commit({ ...edl, chapters: edl.chapters.filter((_, i) => i !== selection.index) })
    } else if (selection.kind === 'words') {
      const [i0, i1] = [Math.min(selection.a, selection.b), Math.max(selection.a, selection.b)]
      const w = b.words
      const allCut = w.slice(i0, i1 + 1).every((x) => keepIndexAt(edl.keep, (x.start + x.end) / 2) < 0)
      const prev = w[i0 - 1]
      const next = w[i1 + 1]
      if (allCut) commit({ ...edl, keep: restoreRange(edl.keep, w[i0].start - 0.08, w[i1].end + 0.15, D) })
      else {
        const a = prev ? Math.max(prev.end + 0.04, w[i0].start - 0.25) : w[i0].start - 0.1
        const z = next ? Math.min(next.start - 0.04, w[i1].end + 0.25) : w[i1].end + 0.1
        commit({ ...edl, keep: cutRange(edl.keep, a, z) })
      }
    }
    setSelection(null)
  }, [b, edl, selection, commit])

  // Zooms and chapters are referred to by index: keep them in time order and follow the edited one.
  const putZoom = useCallback(
    (z: Zoom, index?: number) => {
      if (!edl) return
      const list = index === undefined ? [...edl.zooms, z] : edl.zooms.map((x, i) => (i === index ? z : x))
      const sorted = [...list].sort((a, b) => a.t - b.t)
      commit({ ...edl, zooms: sorted })
      setSelection({ kind: 'zoom', index: sorted.indexOf(z) })
    },
    [edl, commit]
  )

  const putChapter = useCallback(
    (c: Chapter, index?: number) => {
      if (!edl) return
      const list = index === undefined ? [...edl.chapters, c] : edl.chapters.map((x, i) => (i === index ? c : x))
      const sorted = [...list].sort((a, b) => a.t - b.t)
      commit({ ...edl, chapters: sorted })
      setSelection({ kind: 'chapter', index: sorted.indexOf(c) })
    },
    [edl, commit]
  )

  const addZoom = useCallback(() => {
    if (!b) return
    const t = clock.t
    const d = Math.min(2, b.project.media.duration - t)
    if (d >= 0.3) putZoom({ t, d, scale: 1.12 })
  }, [b, putZoom])

  const addChapter = useCallback(() => {
    setTab('transcript')
    putChapter({ t: clock.t, title: 'Nouvelle partie' })
  }, [putChapter])

  const cutSilences = () => {
    if (!b || !edl) return
    let keep = edl.keep
    for (const s of b.silences) if (s.out - s.in > 0.6) keep = cutRange(keep, s.in + 0.15, s.out - 0.15)
    commit({ ...edl, keep })
    notify('Silences de plus de 0,6 s coupés')
  }

  // ---- review ----------------------------------------------------------------
  const startPin = useCallback((sketch: Shape[] = []) => {
    player.current?.pause()
    setDrawMode(false)
    setTab('comments')
    setDraft((d) => ({ t: d?.t ?? clock.t, shapes: sketch.length, sketch }))
  }, [])

  const submitComment = async (text: string) => {
    if (!b || !draft) return
    const id = 'c' + Date.now().toString(36)
    let frame: string | undefined
    const jpg = player.current?.captureFrame(draft.sketch)
    if (jpg) frame = await api.saveFrame(projectId, id, jpg).catch(() => undefined)
    const c: Comment = {
      id,
      t: draft.t,
      text: text || (draft.sketch.length ? 'Voir le dessin' : 'À revoir'),
      sketch: draft.sketch,
      frame,
      createdIn: version,
      createdAt: new Date().toISOString()
    }
    saveComments([...b.comments, c])
    setDraft(null)
  }

  // ---- versions ----------------------------------------------------------------
  const switchVersion = async (v: string) => {
    if (!b) return
    setB({ ...b, project: { ...b.project, current: v } })
    undo.current = []
    redo.current = []
    await api.updateProject(projectId, { current: v })
  }

  /** `base` V0 means a fresh cut from the brief; otherwise Claude applies the open comments. */
  const generate = async (dsId: string, base = version) => {
    setModal(null)
    setOnboarding(false)
    setGenerating(true)
    try {
      const v = await api.generate(projectId, base, dsId)
      await reload()
      notify(`${v} prête`)
      clock.seek(0)
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setGenerating(false)
    }
  }

  const doExport = async (v: string, height: 720 | 1080 | 2160, burn: boolean, extra: Pick<ExportOptions, 'aspect' | 'cropX' | 'srt'> = {}) => {
    setModal(null)
    try {
      const out = await api.exportVideo(projectId, { version: v, height, burnCaptions: burn, ...extra })
      notify('Export terminé')
      void api.reveal(out)
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  // ---- keyboard -----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || onboarding || (e.target instanceof HTMLElement && e.target.closest('input,textarea,select'))) return
      const k = e.key.toLowerCase()
      const mod = e.metaKey || e.ctrlKey
      if (mod && k === 'z') {
        e.preventDefault()
        doUndo(!e.shiftKey)
      } else if (mod && k === 'y') {
        e.preventDefault()
        doUndo(false)
      } else if (drawMode) return
      else if (k === ' ') {
        e.preventDefault()
        player.current?.toggle()
      } else if (k === 'p') startPin()
      else if (k === 'd') {
        player.current?.pause()
        setDrawMode(true)
      } else if (k === 'c') edl && commit({ ...edl, keep: splitAt(edl.keep, clock.t) })
      else if (k === 'delete' || k === 'backspace') {
        e.preventDefault()
        deleteSelection()
      } else if (k === 'arrowleft' || k === 'arrowright') {
        e.preventDefault()
        player.current?.step((k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 25))
      } else if (k === 'escape') {
        setSelection(null)
        setDraft(null)
      } else if (k === 'h') setSkipCuts((s) => !s)
      else if (k === 'z') addZoom()
      else if (k === 'm') addChapter()
      else if (k === '+' || k === '=') setPps((v) => Math.min(400, v * 1.4))
      else if (k === '-') setPps((v) => Math.max(0.5, v / 1.4))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, onboarding, drawMode, edl, commit, deleteSelection, doUndo, startPin, addZoom, addChapter])

  if (!b || !edl) {
    return (
      <div className="editor loading">
        <span className="spin" />
      </div>
    )
  }

  const p = b.project
  const nextName = 'V' + (Math.max(0, ...p.versions.map((v) => Number(v.slice(1)) || 0)) + 1)
  const selectedGfx = selection?.kind === 'gfx' ? edl.gfx.find((g) => g.id === selection.id) : undefined
  const selectedZoom = selection?.kind === 'zoom' ? edl.zooms[selection.index] : undefined
  const selectedChapter = selection?.kind === 'chapter' ? edl.chapters[selection.index] : undefined
  const outDur = editedDuration(edl.keep)
  const chapterEnds = edl.chapters.map((c, i) => srcToOut(edl.keep, edl.chapters[i + 1]?.t ?? p.media.duration) - srcToOut(edl.keep, c.t))
  const firstCut = version === 'V0'
  const canGenerate = firstCut || openComments.length > 0
  const readyCount = Object.values(p.ready).filter(Boolean).length
  const preparing = readyCount < Object.keys(p.ready).length

  const onGenerateClick = () => (firstCut ? setOnboarding(true) : setModal('generate'))

  return (
    <>
      <header className={`topbar${window.rushcut.platform === 'darwin' ? ' mac' : ''}`}>
        <button className="icon-btn" onClick={onClose} aria-label="Retour aux projets" title="Projets">
          <Ic d={I.back} size={18} />
        </button>
        <span className="title" title={p.name}>{p.name}</span>
        {p.versions.length > 1 && (
          <div className="versions" role="tablist" aria-label="Versions">
            {p.versions.map((v) => {
              const e = b.edls[v]
              return (
                <button
                  key={v}
                  className="vchip"
                  role="tab"
                  aria-pressed={v === version}
                  title={v === 'V0' ? 'Rush brut' : e?.status === 'approved' ? 'Approuvée' : e?.status === 'archived' ? 'Archivée' : 'En revue'}
                  onClick={() => void switchVersion(v)}
                >
                  {v === 'V0' ? 'Brut' : v}
                  {e?.status === 'approved' && <Ic d={I.check} size={12} />}
                </button>
              )
            })}
          </div>
        )}
        <div className="spacer" />
        {preparing && (
          <span className="prep" title="Proxy, forme d’onde, silences, vignettes, transcript">
            <span className="spin sm" /> Préparation {readyCount}/{Object.keys(p.ready).length}
          </span>
        )}
        {!firstCut && (
          <button className="btn ghost" disabled={edl.status === 'approved'} onClick={() => commit({ ...edl, status: 'approved' }, false)}>
            <Ic d={I.check} /> {edl.status === 'approved' ? 'Approuvée' : 'Approuver'}
          </button>
        )}
        <button className="btn" onClick={() => setModal('export')}>Exporter</button>
        <button
          className="btn primary"
          disabled={generating || (!firstCut && !canGenerate)}
          title={!canGenerate ? 'Ajoute des commentaires pour générer la version suivante' : ''}
          onClick={onGenerateClick}
        >
          {generating ? (
            <>
              <span className="spin sm dark" /> Claude monte…
            </>
          ) : firstCut ? (
            '✦ Préparer la V1'
          ) : (
            `✦ ${nextName}${openComments.length ? ` · ${openComments.length}` : ''}`
          )}
        </button>
        <button className="icon-btn" onClick={openSettings} aria-label="Réglages" title="Réglages">
          <Ic d={I.gear} size={17} />
        </button>
      </header>

      <div className="editor">
        <div className="ed-main">
          <section className="stage-col">
            {firstCut && !generating ? (
              <button className="banner" onClick={() => setOnboarding(true)}>
                <span className="banner-dot" />
                <span>
                  <b>Rush brut.</b> {p.brief?.done ? 'Ton brief est prêt : lance la V1 quand tu veux.' : 'Réponds à quelques questions et Claude monte la V1.'}
                </span>
                <span className="banner-cta">{p.brief?.done ? 'Monter la V1 →' : 'Commencer →'}</span>
              </button>
            ) : generating ? (
              <div className="banner busy">
                <span className="spin sm" />
                <span>Claude écrit {firstCut ? 'la V1' : nextName} : coupes, séquences, zooms, graphismes, sous-titres…</span>
              </div>
            ) : (
              edl.summary && (
                <div className="summary" title={edl.summary}>
                  <b>{version}</b> {edl.summary}
                </div>
              )
            )}
            <Player
              ref={player}
              project={p}
              edl={edl}
              chunks={chunks}
              ds={ds}
              comments={b.comments}
              drawMode={drawMode}
              skipCuts={skipCuts}
              speed={speed}
              onAttach={(shapes) => startPin(shapes)}
              onCloseDraw={() => setDrawMode(false)}
            />
            <div className="transport">
              <div className="tp-side">
                <Timecode duration={p.media.duration} />
              </div>
              <div className="tp-center">
                <button className="icon-btn" onClick={() => startPin()} title="Pin au timecode (P)" aria-label="Pin">
                  <Ic d={I.pin} />
                </button>
                <button className="icon-btn" aria-pressed={drawMode} onClick={() => (drawMode ? setDrawMode(false) : (player.current?.pause(), setDrawMode(true)))} title="Dessiner sur l’image (D)" aria-label="Dessiner">
                  <Ic d={I.draw} />
                </button>
                <button className="play" onClick={() => player.current?.toggle()} aria-label={playing ? 'Pause' : 'Lecture'} title="Lecture / pause (Espace)">
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button className="icon-btn" onClick={() => commit({ ...edl, keep: splitAt(edl.keep, clock.t) })} title="Couper à la tête de lecture (C)" aria-label="Couper">
                  <Ic d={I.cut} />
                </button>
                <button
                  className="icon-btn"
                  disabled={!selection || (selection.kind === 'clip' && edl.keep.length < 2)}
                  onClick={deleteSelection}
                  title={selection?.kind === 'gap' ? 'Restaurer le passage (Suppr)' : 'Supprimer la sélection (Suppr)'}
                  aria-label="Supprimer"
                >
                  <Ic d={selection?.kind === 'gap' ? I.undo : I.trash} />
                </button>
              </div>
              <div className="tp-side right">
                <button className="icon-btn" disabled={!undo.current.length} onClick={() => doUndo(true)} title="Annuler (⌘Z)" aria-label="Annuler">
                  <Ic d={I.undo} />
                </button>
                <button className="icon-btn" disabled={!redo.current.length} onClick={() => doUndo(false)} title="Rétablir (⇧⌘Z)" aria-label="Rétablir">
                  <Ic d={I.redo} />
                </button>
                <span className="tp-sep" />
                <button className="txt-btn mono" onClick={() => setSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1))} title="Vitesse de lecture">{speed}×</button>
                <button className="txt-btn" aria-pressed={!skipCuts} onClick={() => setSkipCuts((s) => !s)} title="Montrer les passages coupés pendant la lecture (H)">
                  {skipCuts ? 'Monté' : 'Brut'}
                </button>
              </div>
            </div>
          </section>

          <aside className="side">
            {selectedGfx ? (
              <Inspector
                g={selectedGfx}
                projectId={projectId}
                illustrations={p.illustrations ?? []}
                onChange={(g) => commit({ ...edl, gfx: edl.gfx.map((x) => (x.id === g.id ? g : x)) })}
                onDelete={deleteSelection}
                onClose={() => setSelection(null)}
              />
            ) : selectedZoom && selection?.kind === 'zoom' ? (
              <ZoomInspector item={selectedZoom} duration={p.media.duration} onChange={(z) => putZoom(z, selection.index)} onDelete={deleteSelection} onClose={() => setSelection(null)} />
            ) : selectedChapter && selection?.kind === 'chapter' ? (
              <ChapterInspector item={selectedChapter} duration={p.media.duration} onChange={(c) => putChapter(c, selection.index)} onDelete={deleteSelection} onClose={() => setSelection(null)} />
            ) : (
              <>
                <div className="tabs" role="tablist">
                  <button role="tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')}>Transcript</button>
                  <button role="tab" aria-selected={tab === 'comments'} onClick={() => setTab('comments')}>
                    Notes {openComments.length > 0 && <span className="count">{openComments.length}</span>}
                  </button>
                  <button role="tab" aria-selected={tab === 'style'} onClick={() => setTab('style')}>Style</button>
                </div>
                {tab === 'transcript' && (
                  <div className="pane">
                    {selection?.kind === 'words' && <div className="hint">Suppr pour couper ou restaurer ces mots</div>}
                    <Transcript
                      words={b.words}
                      keep={edl.keep}
                      sel={selection?.kind === 'words' ? [selection.a, selection.b] : null}
                      onSelect={(s) => setSelection(s ? { kind: 'words', a: s[0], b: s[1] } : null)}
                      emptyHint={
                        <div className="empty-hint">
                          {p.media.hasAudio ? (
                            projectJobs.some((j) => /transcription|audio/i.test(j.label)) ? (
                              <><span className="spin sm" /> Transcription en cours…</>
                            ) : (
                              <>
                                <p className="muted">Pas encore de transcript.</p>
                                <button className="btn sm" onClick={() => void api.transcribe(projectId).catch((e) => notify(e.message, true))}>Lancer la transcription</button>
                              </>
                            )
                          ) : (
                            <p className="muted">Ce rush n’a pas de piste audio.</p>
                          )}
                          {!(p.ready.proxy && p.ready.sprite) && projectJobs.length === 0 && (
                            <button className="btn sm ghost" onClick={() => void api.resumeImport(projectId)}>Reprendre la préparation</button>
                          )}
                        </div>
                      }
                    />
                    <p className="pane-foot muted">Glisse sur des mots puis <kbd>Suppr</kbd> pour les couper.</p>
                  </div>
                )}
                {tab === 'comments' && (
                  <div className="pane">
                    <Comments
                      projectId={projectId}
                      comments={b.comments}
                      words={b.words}
                      draft={draft}
                      showFixed={showFixed}
                      onSubmit={(t) => void submitComment(t)}
                      onCancel={() => setDraft(null)}
                      onDelete={(id) => saveComments(b.comments.filter((c) => c.id !== id))}
                    />
                    {b.comments.some((c) => c.fixedIn) && (
                      <label className="pane-foot row muted">
                        <input id="showFixed" type="checkbox" checked={showFixed} onChange={(e) => setShowFixed(e.target.checked)} /> Afficher les notes corrigées
                      </label>
                    )}
                  </div>
                )}
                {tab === 'style' && (
                  <StylePanel
                    project={p}
                    edl={edl}
                    ds={ds}
                    dsList={dsList}
                    setDsList={setDsList}
                    outDur={outDur}
                    chapterEnds={chapterEnds}
                    hasSilences={b.silences.length > 0}
                    commit={commit}
                    cutSilences={cutSilences}
                    openBrief={() => setOnboarding(true)}
                    notify={notify}
                  />
                )}
              </>
            )}
          </aside>
        </div>

        <div className="tl-wrap">
          <div className="tl-bar">
            <span className="mono muted">
              {shortTime(p.media.duration)} <span className="arrow">→</span> <b>{shortTime(outDur)}</b>
            </span>
            <span className="tp-sep" />
            <button className="txt-btn" onClick={addZoom} title="Ajouter un zoom à la tête de lecture (Z)">+ Zoom</button>
            <button className="txt-btn" onClick={addChapter} title="Ajouter un chapitre à la tête de lecture (M)">+ Chapitre</button>
            <div className="spacer" />
            <span className="muted tl-hint">Glisse les bords d’un plan pour l’ajuster · Alt : sans magnétisme</span>
            <button className="icon-btn sm" onClick={() => setPps((v) => Math.max(0.5, v / 1.4))} aria-label="Dézoomer" title="Dézoomer (−)">−</button>
            <button className="txt-btn" onClick={() => setPps(Math.max(1, (window.innerWidth - 80) / p.media.duration))}>Ajuster</button>
            <button className="icon-btn sm" onClick={() => setPps((v) => Math.min(400, v * 1.4))} aria-label="Zoomer" title="Zoomer (+)">+</button>
          </div>
          <Timeline
            project={p}
            keep={edl.keep}
            gfx={edl.gfx}
            zooms={edl.zooms}
            chapters={edl.chapters}
            words={b.words}
            comments={openComments}
            peaks={b.peaks}
            pps={pps}
            setPps={setPps}
            selection={selection}
            onSelect={setSelection}
            onEdit={(patch, select) => {
              commit({ ...edl, ...patch })
              setSelection(select)
            }}
          />
        </div>
      </div>

      {onboarding && (
        <Onboarding
          project={p}
          jobs={projectJobs}
          hasWords={b.words.length > 0}
          notify={notify}
          onSkip={() => {
            setOnboarding(false)
            void reload()
          }}
          onGenerate={(d) => void generate(d, 'V0')}
        />
      )}
      {modal === 'generate' && (
        <GenerateModal project={p} base={version} nextName={nextName} openComments={openComments.length} onClose={() => setModal(null)} onGenerate={(d) => void generate(d)} notify={notify} />
      )}
      {modal === 'export' && <ExportModal project={p} versions={p.versions} current={version} onClose={() => setModal(null)} onExport={(v, h, burn, extra) => void doExport(v, h, burn, extra)} />}
    </>
  )
}
