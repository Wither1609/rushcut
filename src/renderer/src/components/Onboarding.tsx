// First-run questions for a new project. Answers become the brief Claude reads before the V1.
import { useEffect, useMemo, useState } from 'react'
import { api, mediaUrl } from '../api'
import type { Notify } from '../App'
import { DsPreview } from './GenerateModal'
import { CaptionPreview, GfxArt, PaceArt, TemplateArt, useLoop, ZoomArt } from './Art'
import { CAPTION_STYLES, defaultBrief, getTemplate, GFX_LEVELS, GOALS, PACES, TEMPLATES, TONES, ZOOMS } from '../../../shared/templates'
import { shortTime } from '../../../shared/edl'
import { BUILTIN_DS, type Brief, type DesignSystem, type Illustration, type JobState, type Project } from '../../../shared/types'

interface Props {
  project: Project
  jobs: JobState[]
  hasWords: boolean
  notify: Notify
  onSkip: () => void
  onGenerate: (dsId: string) => void
}

const STEPS = ['Bienvenue', 'Modèle', 'Intention', 'Rythme', 'Look', 'Images', 'C’est parti'] as const

const GoalIcon = ({ id }: { id: Brief['goal'] }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {id === 'inform' && <path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0012 3z" />}
    {id === 'sell' && <path d="M3 4h2l2.4 11.2a1 1 0 001 .8h8.9a1 1 0 001-.8L20 8H6.2M9 20h.01M17 20h.01" />}
    {id === 'entertain' && <path d="M4 5h16v11H4zM8 20h8M10 8.5v4l3.5-2z" />}
    {id === 'inspire' && <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />}
  </svg>
)

export function Onboarding({ project, jobs, hasWords, notify, onSkip, onGenerate }: Props) {
  const [step, setStep] = useState(project.brief?.done ? 1 : 0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [brief, setBrief] = useState<Brief>(project.brief ?? defaultBrief(project.media.height > project.media.width ? 'reel' : 'tuto'))
  const [ds, setDs] = useState(project.designSystem)
  const [dsList, setDsList] = useState<DesignSystem[]>(BUILTIN_DS)
  const [notes, setNotes] = useState(project.notes)
  const [recipe, setRecipe] = useState(project.recipe)
  const [images, setImages] = useState<Illustration[]>(project.illustrations ?? [])
  const [busy, setBusy] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const loop = useLoop(2.6)
  const vertical = project.media.height > project.media.width
  const set = (patch: Partial<Brief>) => setBrief((b) => ({ ...b, ...patch }))
  const currentDs = dsList.find((d) => d.id === ds) ?? BUILTIN_DS[0]

  useEffect(() => void api.designSystems().then(setDsList), [])

  // Answers are saved as you go, so closing the window loses nothing.
  useEffect(() => {
    const id = setTimeout(() => void api.updateProject(project.id, { brief, designSystem: ds, notes }).catch(() => undefined), 300)
    return () => clearTimeout(id)
  }, [brief, ds, notes, project.id])

  const go = (n: number) => {
    setDir(n > step ? 1 : -1)
    setStep(Math.max(0, Math.min(STEPS.length - 1, n)))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select')) return
      if (e.key === 'Enter' && step < STEPS.length - 1) {
        e.preventDefault()
        go(step + 1)
      } else if (e.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pickTemplate = (id: string) => {
    const t = getTemplate(id)
    if (t) {
      setBrief((b) => ({ ...b, template: id, ...t.preset, tone: [...t.preset.tone] }))
      setDs(t.ds)
    } else set({ template: id })
  }

  const reference = async () => {
    setBusy('ref')
    try {
      const r = await api.reference(project.id)
      if (r) {
        setRecipe(r)
        set({ template: 'reference' })
        notify('Montage de l’exemple analysé')
      }
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(null)
    }
  }

  const importDs = async () => {
    setBusy('ds')
    try {
      const d = await api.designSystemFromImage()
      if (d) {
        setDsList(await api.designSystems())
        setDs(d.id)
      }
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(null)
    }
  }

  const addImages = async (files?: string[]) => {
    setBusy('img')
    try {
      const list = await api.addIllustrations(project.id, files)
      if (list) setImages(list)
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(null)
    }
  }

  const relabel = (file: string, label: string) => {
    const list = images.map((i) => (i.file === file ? { ...i, label } : i))
    setImages(list)
    void api.updateProject(project.id, { illustrations: list })
  }

  const finish = async () => {
    const done = { ...brief, done: true }
    setBrief(done)
    await api.updateProject(project.id, { brief: done, designSystem: ds, notes })
    onGenerate(ds)
  }

  const transcribing = jobs.find((j) => /transcription|audio/i.test(j.label) && j.status !== 'done')
  const tpl = getTemplate(brief.template)
  const thumb = project.sprite
  const thumbStyle = useMemo(() => {
    if (!thumb) return undefined
    const rows = Math.ceil(thumb.count / thumb.cols)
    const i = Math.floor(thumb.count / 3)
    const x = thumb.cols > 1 ? ((i % thumb.cols) / (thumb.cols - 1)) * 100 : 0
    const y = rows > 1 ? (Math.floor(i / thumb.cols) / (rows - 1)) * 100 : 0
    return { backgroundImage: `url("${mediaUrl(project.id, thumb.file)}")`, backgroundSize: `${thumb.cols * 100}% ${rows * 100}%`, backgroundPosition: `${x}% ${y}%` }
  }, [thumb, project.id])

  return (
    <div className="ob" role="dialog" aria-label="Préparer le montage">
      <div className={`ob-top${window.rushcut.platform === 'darwin' ? ' mac' : ''}`}>
        <div className="ob-progress" aria-hidden="true">
          {STEPS.map((s, i) => (
            <button key={s} className={`ob-dot${i === step ? ' on' : i < step ? ' done' : ''}`} onClick={() => go(i)} title={s} tabIndex={-1} />
          ))}
        </div>
        <span className="ob-count mono">{step > 0 ? `${step} / ${STEPS.length - 1}` : ''}</span>
        <div className="spacer" />
        <button className="btn ghost" onClick={onSkip}>Passer <kbd>Échap</kbd></button>
      </div>

      <div className="ob-body">
        <div key={step} className="ob-step" style={{ ['--dir' as string]: dir }}>
          {step === 0 && (
            <div className="ob-hello">
              <div className="ob-thumb" style={{ aspectRatio: `${project.media.width} / ${project.media.height}` }}>
                <i style={thumbStyle} />
                <span className="ob-scan" />
              </div>
              <div className="col" style={{ gap: 18, maxWidth: 460 }}>
                <span className="eyebrow ob-in" style={{ ['--i' as string]: 0 }}>{project.name}</span>
                <h1 className="ob-h1 ob-in" style={{ ['--i' as string]: 1 }}>
                  Avant de monter, <em>parlons de ta vidéo.</em>
                </h1>
                <p className="ob-lead ob-in" style={{ ['--i' as string]: 2 }}>
                  Six questions rapides : le modèle, l’intention, le rythme, le look, tes images. Claude s’en sert pour monter une V1 qui te ressemble.
                </p>
                <div className="row ob-in" style={{ ['--i' as string]: 3, flexWrap: 'wrap' }}>
                  <span className="pill">{shortTime(project.media.duration)}</span>
                  <span className="pill">{vertical ? 'vertical' : 'horizontal'} · {project.media.width}×{project.media.height}</span>
                  <span className={`pill${hasWords ? ' ok' : ''}`}>{hasWords ? 'transcript prêt' : transcribing ? 'transcription en cours…' : 'sans transcript'}</span>
                </div>
                <div className="row ob-in" style={{ ['--i' as string]: 4, marginTop: 6 }}>
                  <button className="btn primary lg" onClick={() => go(1)}>
                    Commencer <kbd>↵</kbd>
                  </button>
                  <button className="btn ghost" onClick={onSkip}>Explorer le rush brut d’abord</button>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <Section title="Quel genre de vidéo ?" lead="Le modèle règle le rythme, les sous-titres et les graphismes. Tu pourras tout ajuster ensuite.">
              <div className="ob-grid tpl">
                {TEMPLATES.map((t, i) => (
                  <button key={t.id} className="ob-card ob-in" style={{ ['--i' as string]: i }} aria-pressed={brief.template === t.id} onClick={() => pickTemplate(t.id)}>
                    <TemplateArt id={t.id} />
                    <div className="ob-card-b">
                      <div className="row">
                        <b>{t.name}</b>
                        <div className="spacer" />
                        <span className="pill">{t.format}</span>
                      </div>
                      <span className="muted">{t.tagline}</span>
                    </div>
                  </button>
                ))}
                <button className="ob-card ob-in" style={{ ['--i' as string]: TEMPLATES.length }} aria-pressed={brief.template === 'reference'} disabled={busy === 'ref'} onClick={() => (recipe ? set({ template: 'reference' }) : void reference())}>
                  <TemplateArt id="reference" />
                  <div className="ob-card-b">
                    <b>{busy === 'ref' ? 'Analyse de l’exemple…' : recipe ? `Comme « ${recipe.source} »` : 'Copier une vidéo'}</b>
                    <span className="muted">{recipe ? recipe.rhythm : 'Choisis une vidéo dont tu aimes le montage : Claude en tire la recette.'}</span>
                  </div>
                </button>
              </div>
            </Section>
          )}

          {step === 2 && (
            <Section title="Qu’est-ce que la vidéo doit provoquer ?" lead="Claude choisit quoi garder et quoi souligner selon l’objectif.">
              <div className="ob-grid four">
                {GOALS.map((g, i) => (
                  <button key={g.id} className="ob-card goal ob-in" style={{ ['--i' as string]: i }} aria-pressed={brief.goal === g.id} onClick={() => set({ goal: g.id })}>
                    <span className="goal-ic"><GoalIcon id={g.id} /></span>
                    <b>{g.label}</b>
                    <span className="muted">{g.hint}</span>
                  </button>
                ))}
              </div>
              <label className="field ob-in" style={{ ['--i' as string]: 4 }}>
                <span>Pour qui ?</span>
                <input id="audience" className="input lg" placeholder="Ex. : entrepreneurs qui débutent sur LinkedIn" value={brief.audience} onChange={(e) => set({ audience: e.target.value })} />
              </label>
              <div className="col ob-in" style={{ ['--i' as string]: 5 }}>
                <span className="ob-label">Le ton <span className="muted">(3 maximum)</span></span>
                <div className="chips">
                  {TONES.map((t) => {
                    const on = brief.tone.includes(t)
                    return (
                      <button key={t} className="chip" aria-pressed={on} disabled={!on && brief.tone.length >= 3} onClick={() => set({ tone: on ? brief.tone.filter((x) => x !== t) : [...brief.tone, t] })}>
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>
            </Section>
          )}

          {step === 3 && (
            <Section title="Quel rythme ?" lead="La durée moyenne d’un plan et la fréquence des zooms.">
              <div className="ob-grid three">
                {PACES.map((p, i) => (
                  <button key={p.id} className="ob-card ob-in" style={{ ['--i' as string]: i }} aria-pressed={brief.pace === p.id} onClick={() => set({ pace: p.id })}>
                    <PaceArt pace={p.id} />
                    <div className="ob-card-b">
                      <b>{p.label}</b>
                      <span className="muted">{p.hint}</span>
                    </div>
                  </button>
                ))}
              </div>
              <span className="ob-label ob-in" style={{ ['--i' as string]: 3 }}>Zooms</span>
              <div className="ob-grid three">
                {ZOOMS.map((z, i) => (
                  <button key={z.id} className="ob-card compact ob-in" style={{ ['--i' as string]: 4 + i }} aria-pressed={brief.zooms === z.id} onClick={() => set({ zooms: z.id })}>
                    <ZoomArt level={z.id} />
                    <div className="ob-card-b"><b>{z.label}</b></div>
                  </button>
                ))}
              </div>
              <button className="ob-toggle ob-in" style={{ ['--i' as string]: 7 }} aria-pressed={brief.hook} onClick={() => set({ hook: !brief.hook })}>
                <span className="sw-track"><i /></span>
                <span className="col" style={{ gap: 2, textAlign: 'left' }}>
                  <b>Accroche dès la première seconde</b>
                  <span className="muted">Claude coupe l’intro et démarre sur la phrase la plus forte.</span>
                </span>
              </button>
            </Section>
          )}

          {step === 4 && (
            <Section title="Le look" lead="Le design system habille les titres et les graphismes. Le style de sous-titres, chaque mot.">
              <span className="ob-label">Design system</span>
              <div className="ob-grid ds4">
                {dsList.map((d, i) => (
                  <button key={d.id} className="ob-card compact ob-in" style={{ ['--i' as string]: i }} aria-pressed={d.id === ds} onClick={() => setDs(d.id)}>
                    <div className="ds-prev"><DsPreview ds={d} /></div>
                    <div className="ob-card-b row">
                      <b>{d.name}</b>
                      <div className="spacer" />
                      <span className="sw">
                        <i style={{ background: d.bg }} />
                        <i style={{ background: d.accent }} />
                      </span>
                    </div>
                  </button>
                ))}
                <button className="ob-card compact dashed ob-in" style={{ ['--i' as string]: dsList.length }} onClick={() => void importDs()} disabled={busy === 'ds'}>
                  <div className="ob-plus">{busy === 'ds' ? 'Claude lit l’image…' : '+'}</div>
                  <div className="ob-card-b">
                    <b>Depuis une image</b>
                    <span className="muted">Capture, deck ou site</span>
                  </div>
                </button>
              </div>
              <span className="ob-label">Sous-titres</span>
              <div className="ob-grid four">
                {CAPTION_STYLES.map((c, i) => (
                  <button key={c.id} className="ob-card compact ob-in" style={{ ['--i' as string]: 6 + i }} aria-pressed={brief.captionStyle === c.id} onClick={() => set({ captionStyle: c.id })}>
                    <CaptionPreview style={c.id} ds={currentDs} t={loop} />
                    <div className="ob-card-b">
                      <b>{c.label}</b>
                      <span className="muted">{c.hint}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {step === 5 && (
            <Section title="Des images pour illustrer ?" lead="Logo, produit, photos du lieu, captures… Claude les place au moment où tu en parles, en carte ou en plein écran.">
              <div
                className={`ob-drop${over ? ' over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setOver(false)
                  const files = [...e.dataTransfer.files].map((f) => window.rushcut.pathForFile(f))
                  if (files.length) void addImages(files)
                }}
              >
                {images.map((im, i) => (
                  <div key={im.file} className="ob-img ob-in" style={{ ['--i' as string]: i }}>
                    <img src={mediaUrl(project.id, `assets/${encodeURIComponent(im.file)}`)} alt={im.label} />
                    <input aria-label="Ce que montre l’image" className="input" value={im.label} onChange={(e) => relabel(im.file, e.target.value)} />
                    <button className="x" aria-label="Retirer l’image" onClick={() => void api.removeIllustration(project.id, im.file).then(setImages)}>✕</button>
                  </div>
                ))}
                <button className="ob-img add" onClick={() => void addImages()} disabled={busy === 'img'}>
                  <span className="ob-plus">+</span>
                  <span className="muted">{busy === 'img' ? 'Import…' : images.length ? 'Ajouter' : 'Glisse tes images ici'}</span>
                </button>
              </div>
              {images.length > 0 && <p className="muted" style={{ fontSize: 12 }}>Décris chaque image en quelques mots : Claude s’en sert pour la placer au bon moment.</p>}
              <span className="ob-label">Motion design</span>
              <div className="ob-grid three">
                {GFX_LEVELS.map((g, i) => (
                  <button key={g.id} className="ob-card compact ob-in" style={{ ['--i' as string]: i }} aria-pressed={brief.gfx === g.id} onClick={() => set({ gfx: g.id })}>
                    <GfxArt level={g.id} />
                    <div className="ob-card-b">
                      <b>{g.label}</b>
                      <span className="muted">{g.hint}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {step === 6 && (
            <Section title="Tout est prêt." lead="Un dernier mot pour Claude ? Sinon, lance la V1 : l’aperçu est immédiat, rien n’est rendu.">
              <div className="ob-recap">
                <Recap label="Modèle" value={brief.template === 'reference' ? `Comme « ${recipe?.source ?? 'exemple'} »` : tpl?.name ?? '—'} onEdit={() => go(1)} i={0} />
                <Recap label="Objectif" value={`${GOALS.find((g) => g.id === brief.goal)?.label}${brief.audience ? ` · ${brief.audience}` : ''}`} onEdit={() => go(2)} i={1} />
                <Recap label="Ton" value={brief.tone.join(', ') || '—'} onEdit={() => go(2)} i={2} />
                <Recap label="Rythme" value={`${PACES.find((p) => p.id === brief.pace)?.label} · zooms ${ZOOMS.find((z) => z.id === brief.zooms)?.label.toLowerCase()}${brief.hook ? ' · accroche' : ''}`} onEdit={() => go(3)} i={3} />
                <Recap label="Look" value={`${currentDs.name} · sous-titres ${CAPTION_STYLES.find((c) => c.id === brief.captionStyle)?.label.toLowerCase()}`} onEdit={() => go(4)} i={4} />
                <Recap label="Images" value={`${images.length} image${images.length > 1 ? 's' : ''} · motion design ${GFX_LEVELS.find((g) => g.id === brief.gfx)?.label.toLowerCase()}`} onEdit={() => go(5)} i={5} />
              </div>
              <label className="field ob-in" style={{ ['--i' as string]: 6 }}>
                <span>Consignes libres (facultatif)</span>
                <textarea id="notes" className="textarea" value={notes} placeholder="Ex. : garder la blague sur le café, ne pas couper la démo, finir sur l’appel à s’abonner." onChange={(e) => setNotes(e.target.value)} />
              </label>
              {!hasWords && (
                <div className="ob-wait ob-in" style={{ ['--i' as string]: 7 }}>
                  <span className="spin" />
                  {transcribing ? (
                    <span>Transcription en cours{transcribing.progress >= 0 ? ` (${Math.round(transcribing.progress * 100)} %)` : ''}. Le bouton s’active dès qu’elle est terminée.</span>
                  ) : project.media.hasAudio ? (
                    <>
                      <span>Il faut le transcript pour monter.</span>
                      <button className="btn sm" onClick={() => void api.transcribe(project.id).catch((e) => notify(e.message, true))}>Lancer la transcription</button>
                    </>
                  ) : (
                    <span>Ce rush n’a pas de piste audio : Claude ne peut pas le monter depuis un transcript.</span>
                  )}
                </div>
              )}
            </Section>
          )}
        </div>
      </div>

      {step > 0 && (
        <div className="ob-foot">
          <button className="btn ghost" onClick={() => go(step - 1)}>← Retour</button>
          <div className="spacer" />
          {step < STEPS.length - 1 ? (
            <button className="btn primary lg" onClick={() => go(step + 1)}>
              Continuer <kbd>↵</kbd>
            </button>
          ) : (
            <button className="btn primary lg glow" disabled={!hasWords} onClick={() => void finish()}>
              ✦ Monter la V1
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="ob-section">
      <h2 className="ob-h2">{title}</h2>
      <p className="ob-lead">{lead}</p>
      {children}
    </div>
  )
}

function Recap({ label, value, onEdit, i }: { label: string; value: string; onEdit: () => void; i: number }) {
  return (
    <button className="ob-rc ob-in" style={{ ['--i' as string]: i }} onClick={onEdit}>
      <span className="eyebrow">{label}</span>
      <span>{value}</span>
      <span className="muted">modifier</span>
    </button>
  )
}
