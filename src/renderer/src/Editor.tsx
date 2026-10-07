import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { clock } from './clock'
import { Logo, type Notify } from './App'
import { Player, Timecode, type PlayerHandle } from './components/Player'
import { Transcript } from './components/Transcript'
import { Comments, type Draft } from './components/Comments'
import { Timeline, type Selection } from './components/Timeline'
import { Inspector } from './components/Inspector'
import { GenerateModal } from './components/GenerateModal'
import { ExportModal } from './components/ExportModal'
import { cutRange, editedDuration, keepIndexAt, restoreRange, shortTime, splitAt, srcToOut } from '../../shared/edl'
import { buildChunks } from '../../shared/overlay'
import { BUILTIN_DS, type Comment, type DesignSystem, type Edl, type JobState, type ProjectBundle, type Shape } from '../../shared/types'

interface Props {
  projectId: string
  onClose: () => void
  openSettings: () => void
  notify: Notify
  jobs: JobState[]
}

export function Editor({ projectId, onClose, openSettings, notify, jobs }: Props) {
  const [b, setB] = useState<ProjectBundle | null>(null)
  const [dsList, setDsList] = useState<DesignSystem[]>(BUILTIN_DS)
  const [selection, setSelection] = useState<Selection>(null)
  const [drawMode, setDrawMode] = useState(false)
  const [draft, setDraft] = useState<(Draft & { sketch: Shape[] }) | null>(null)
  const [modal, setModal] = useState<'generate' | 'export' | null>(null)
  const [skipCuts, setSkipCuts] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [pps, setPps] = useState(20)
  const [showFixed, setShowFixed] = useState(false)
  const [generating, setGenerating] = useState(false)
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

  // Fit the whole raw in the timeline on first load.
  const fitted = useRef(false)
  useEffect(() => {
    if (b && !fitted.current) {
      fitted.current = true
      setPps(Math.max(1, (window.innerWidth - 80) / b.project.media.duration))
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

  const generate = async (dsId: string) => {
    setModal(null)
    setGenerating(true)
    try {
      const v = await api.generate(projectId, version, dsId)
      await reload()
      notify(`${v} prête`)
      clock.seek(0)
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setGenerating(false)
    }
  }

  const doExport = async (v: string, height: 720 | 1080 | 2160, burn: boolean) => {
    setModal(null)
    try {
      const out = await api.exportVideo(projectId, { version: v, height, burnCaptions: burn })
      notify('Export terminé')
      void api.reveal(out)
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  // ---- keyboard -----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || (e.target instanceof HTMLElement && e.target.closest('input,textarea,select'))) return
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
      else if (k === '+' || k === '=') setPps((v) => Math.min(400, v * 1.4))
      else if (k === '-') setPps((v) => Math.max(0.5, v / 1.4))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, drawMode, edl, commit, deleteSelection, doUndo, startPin])

  if (!b || !edl) {
    return (
      <div className="editor" style={{ display: 'grid', placeItems: 'center' }}>
        <span className="muted">Chargement…</span>
      </div>
    )
  }

  const p = b.project
  const nextName = 'V' + (Math.max(0, ...p.versions.map((v) => Number(v.slice(1)) || 0)) + 1)
  const selectedGfx = selection?.kind === 'gfx' ? edl.gfx.find((g) => g.id === selection.id) : undefined
  const outDur = editedDuration(edl.keep)
  const chapterEnds = edl.chapters.map((c, i) => srcToOut(edl.keep, edl.chapters[i + 1]?.t ?? p.media.duration) - srcToOut(edl.keep, c.t))
  const canGenerate = version === 'V0' || openComments.length > 0

  return (
    <>
      <header className={`topbar${window.rushcut.platform === 'darwin' ? ' mac' : ''}`}>
        <button className="btn ghost" onClick={onClose} aria-label="Retour aux projets">←</button>
        <div className="brand">
          <Logo />
        </div>
        <span className="crumb" title={p.name}>{p.name}</span>
        <div className="versions" role="tablist" aria-label="Versions">
          {p.versions.map((v) => {
            const e = b.edls[v]
            return (
              <button key={v} className="vchip" role="tab" aria-pressed={v === version} onClick={() => void switchVersion(v)}>
                {v}
                <span className={`st${e?.status === 'approved' ? ' ok' : ''}`}>{v === 'V0' ? 'brut' : e?.status === 'approved' ? '✓' : e?.status === 'archived' ? 'archivée' : 'en revue'}</span>
              </button>
            )
          })}
        </div>
        <div className="spacer" />
        <button
          className="btn primary"
          disabled={generating || !b.words.length || !canGenerate}
          title={!b.words.length ? 'Il faut d’abord le transcript' : !canGenerate ? 'Ajoute des commentaires pour générer la version suivante' : ''}
          onClick={() => setModal('generate')}
        >
          {generating ? 'Claude travaille…' : version === 'V0' ? `✦ Générer ${nextName}` : `✦ Générer ${nextName} · ${openComments.length}`}
        </button>
        {version !== 'V0' && (
          <button className="btn good" disabled={edl.status === 'approved'} onClick={() => commit({ ...edl, status: 'approved' }, false)}>
            {edl.status === 'approved' ? '✓ Approuvée' : `✓ Approuver ${version}`}
          </button>
        )}
        <button className="btn" onClick={() => setModal('export')}>Exporter</button>
        <button className="btn ghost" onClick={openSettings}>Réglages</button>
      </header>

      <div className="editor">
        <div className="ed-main">
          <aside className="left">
            <div className="section">
              <span className="eyebrow">Séquences</span>
              {edl.chapters.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Claude découpe la vidéo en séquences au moment de générer la V1.</p>}
              {edl.chapters.map((c, i) => (
                <button key={i} className="chapter" onClick={() => clock.seek(c.t)}>
                  <span className="n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="t">{c.title}</span>
                  <span className="d">{chapterEnds[i].toFixed(1)} s</span>
                </button>
              ))}
            </div>
            <div className="section">
              <span className="eyebrow">Montage</span>
              <div className="row mono" style={{ fontSize: 12 }}>
                <span className="muted">Brut</span> {shortTime(p.media.duration)}
                <span className="muted">→ Monté</span> <b>{shortTime(outDur)}</b>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <span className="pill">{edl.keep.length} plans</span>
                <span className="pill gfx">{edl.gfx.length} graphismes</span>
                <span className="pill accent">{edl.zooms.length} zooms</span>
              </div>
              <button className="btn sm" disabled={!b.silences.length} onClick={cutSilences}>Couper les silences</button>
              <label className="row" style={{ fontSize: 12 }}>
                <input id="captions" type="checkbox" checked={edl.captions.enabled} onChange={(e) => commit({ ...edl, captions: { ...edl.captions, enabled: e.target.checked } })} />
                Sous-titres mot à mot
              </label>
              {edl.captions.enabled && (
                <div className="row" style={{ fontSize: 12 }}>
                  <span className="muted">Mots par ligne</span>
                  <input id="maxWords" className="input mono" style={{ width: 60, padding: '3px 6px' }} type="number" min={1} max={8} value={edl.captions.maxWords} onChange={(e) => commit({ ...edl, captions: { ...edl.captions, maxWords: Math.min(8, Math.max(1, Number(e.target.value) || 3)) } })} />
                  <label className="row">
                    <input id="uppercase" type="checkbox" checked={edl.captions.uppercase} onChange={(e) => commit({ ...edl, captions: { ...edl.captions, uppercase: e.target.checked } })} /> MAJ
                  </label>
                </div>
              )}
            </div>
            <div className="section">
              <span className="eyebrow">Préparation</span>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {(['proxy', 'peaks', 'silences', 'sprite', 'transcript'] as const).map((k) => (
                  <span key={k} className={`pill${p.ready[k] ? ' ok' : ''}`}>{{ proxy: 'proxy', peaks: 'onde', silences: 'silences', sprite: 'vignettes', transcript: 'transcript' }[k]}</span>
                ))}
              </div>
              {!p.ready.transcript && (
                <button className="btn sm" onClick={() => void api.transcribe(projectId).catch((e) => notify(e.message, true))}>Lancer la transcription</button>
              )}
              {!(p.ready.proxy && p.ready.sprite) && projectJobs.length === 0 && (
                <button className="btn sm ghost" onClick={() => void api.resumeImport(projectId)}>Reprendre la préparation</button>
              )}
            </div>
            {p.recipe && (
              <div className="section recipe">
                <span className="eyebrow">Montage copié de</span>
                <span>{p.recipe.source}</span>
                <span className="muted">{p.recipe.summary}</span>
              </div>
            )}
          </aside>

          <section className="stage-col">
            {edl.summary && version !== 'V0' && (
              <div className="summary" title={edl.summary}>
                <b>{version}</b> · {edl.summary}
              </div>
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
              <button className="btn primary" onClick={() => player.current?.toggle()}>
                ▶︎ ❚❚ <kbd>Espace</kbd>
              </button>
              <button className="btn" onClick={() => startPin()}>📍 Pin <kbd>P</kbd></button>
              <button className="btn" aria-pressed={drawMode} onClick={() => (drawMode ? setDrawMode(false) : (player.current?.pause(), setDrawMode(true)))}>✎ Dessiner <kbd>D</kbd></button>
              <button className="btn" onClick={() => commit({ ...edl, keep: splitAt(edl.keep, clock.t) })}>✂ Couper <kbd>C</kbd></button>
              <button className="btn" disabled={!selection || selection.kind === 'clip' && edl.keep.length < 2} onClick={deleteSelection}>
                {selection?.kind === 'gap' ? 'Restaurer' : 'Supprimer'} <kbd>Suppr</kbd>
              </button>
              <button className="btn mono" onClick={() => setSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1))}>{speed}×</button>
              <button className="btn" aria-pressed={!skipCuts} onClick={() => setSkipCuts((s) => !s)} title="Afficher les passages coupés pendant la lecture (H)">
                {skipCuts ? 'Lecture montée' : 'Lecture brute'} <kbd>H</kbd>
              </button>
              <div className="spacer" />
              <Timecode duration={p.media.duration} />
            </div>
          </section>

          <aside className="right">
            <div className="pane">
              <div className="pane-h">
                <span className="eyebrow">Transcript</span>
                <div className="spacer" />
                {selection?.kind === 'words' ? <span className="pill accent">Suppr pour couper / restaurer</span> : <span className="pill">glisser pour sélectionner</span>}
              </div>
              <Transcript
                words={b.words}
                keep={edl.keep}
                sel={selection?.kind === 'words' ? [selection.a, selection.b] : null}
                onSelect={(s) => setSelection(s ? { kind: 'words', a: s[0], b: s[1] } : null)}
                emptyHint={
                  <p className="muted" style={{ fontSize: 13 }}>
                    {p.media.hasAudio ? 'Le transcript apparaîtra ici dès que la transcription ElevenLabs est terminée.' : 'Ce rush n’a pas de piste audio.'}
                  </p>
                }
              />
            </div>
            <div className="pane">
              {selectedGfx ? (
                <Inspector
                  g={selectedGfx}
                  onChange={(g) => commit({ ...edl, gfx: edl.gfx.map((x) => (x.id === g.id ? g : x)) })}
                  onDelete={deleteSelection}
                  onClose={() => setSelection(null)}
                />
              ) : (
                <>
                  <div className="pane-h">
                    <span className="eyebrow">Commentaires</span>
                    <span className="pill pin">{openComments.length} ouvert{openComments.length > 1 ? 's' : ''}</span>
                    <div className="spacer" />
                    <label className="row" style={{ fontSize: 11 }}>
                      <input id="showFixed" type="checkbox" checked={showFixed} onChange={(e) => setShowFixed(e.target.checked)} /> corrigés
                    </label>
                  </div>
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
                </>
              )}
            </div>
          </aside>
        </div>

        <div className="tl-wrap">
          <div className="tl-bar">
            <span className="eyebrow">Timeline</span>
            <button className="btn sm ghost" disabled={!undo.current.length} onClick={() => doUndo(true)}>↶ Annuler</button>
            <button className="btn sm ghost" disabled={!redo.current.length} onClick={() => doUndo(false)}>↷ Rétablir</button>
            <div className="spacer" />
            <span className="mono muted" style={{ fontSize: 11 }}>BRUT {shortTime(p.media.duration)} · MONTÉ {shortTime(outDur)}</span>
            <button className="btn sm ghost" onClick={() => setPps((v) => Math.max(0.5, v / 1.4))} aria-label="Dézoomer">−</button>
            <button className="btn sm ghost" onClick={() => setPps(Math.max(1, (window.innerWidth - 80) / p.media.duration))}>Ajuster</button>
            <button className="btn sm ghost" onClick={() => setPps((v) => Math.min(400, v * 1.4))} aria-label="Zoomer">+</button>
          </div>
          <Timeline
            project={p}
            keep={edl.keep}
            gfx={edl.gfx}
            zooms={edl.zooms}
            chapters={edl.chapters}
            comments={openComments}
            peaks={b.peaks}
            pps={pps}
            setPps={setPps}
            selection={selection}
            onSelect={setSelection}
          />
        </div>
      </div>

      {modal === 'generate' && (
        <GenerateModal project={p} base={version} nextName={nextName} openComments={openComments.length} onClose={() => setModal(null)} onGenerate={(d) => void generate(d)} notify={notify} />
      )}
      {modal === 'export' && <ExportModal project={p} versions={p.versions} current={version} onClose={() => setModal(null)} onExport={(v, h, burn) => void doExport(v, h, burn)} />}
    </>
  )
}
