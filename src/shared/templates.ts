// Video templates offered by the onboarding. Each one presets the brief and tells Claude how
// that kind of video is usually cut.
import type { Brief, CaptionStyle } from './types'

export interface VideoTemplate {
  id: string
  name: string
  tagline: string
  format: '9:16' | '16:9' | '1:1'
  ds: string
  preset: Pick<Brief, 'goal' | 'pace' | 'zooms' | 'gfx' | 'captionStyle' | 'hook' | 'tone'>
  /** Editing guidance sent to Claude, in English like the rest of the prompt. */
  guide: string
}

export const TEMPLATES: VideoTemplate[] = [
  {
    id: 'reel',
    name: 'Reel / Short',
    tagline: 'Accroche en 2 s, coupes serrées, sous-titres XXL',
    format: '9:16',
    ds: 'carte',
    preset: { goal: 'entertain', pace: 'punchy', zooms: 'dynamic', gfx: 'light', captionStyle: 'pop', hook: true, tone: ['énergique', 'direct'] },
    guide: 'Short-form vertical video (TikTok, Reels, Shorts). Open on the strongest line within the first 2 seconds. No breath left between sentences. Captions carry the video: 2 words per group. Callouts for punchlines, no title cards. Target 30–60 s if the material allows.'
  },
  {
    id: 'tuto',
    name: 'Tutoriel',
    tagline: 'Étapes numérotées, titres de partie, rythme clair',
    format: '16:9',
    ds: 'nuit',
    preset: { goal: 'inform', pace: 'balanced', zooms: 'subtle', gfx: 'rich', captionStyle: 'box', hook: false, tone: ['pédagogue', 'clair'] },
    guide: 'Educational YouTube tutorial. Short intro saying what the viewer will learn, then one chapter per step with a title card. Use list graphics whenever steps or options are enumerated, number graphics for figures. Keep explanations complete; cut only hesitations and repetitions.'
  },
  {
    id: 'podcast',
    name: 'Extrait podcast',
    tagline: 'Laisser respirer, mettre les phrases fortes en avant',
    format: '1:1',
    ds: 'revue',
    preset: { goal: 'inspire', pace: 'calm', zooms: 'subtle', gfx: 'light', captionStyle: 'minimal', hook: true, tone: ['posé', 'sincère'] },
    guide: 'Podcast or conversation clip. Keep natural pauses that carry meaning; remove only dead air and false starts. Quote graphics for the most quotable sentences, a lower third naming the speaker near the start. Few zooms, slow and subtle.'
  },
  {
    id: 'pub',
    name: 'Pub produit',
    tagline: 'Problème, solution, preuve, appel à l’action',
    format: '9:16',
    ds: 'ambre',
    preset: { goal: 'sell', pace: 'punchy', zooms: 'dynamic', gfx: 'rich', captionStyle: 'karaoke', hook: true, tone: ['convaincant', 'énergique'] },
    guide: 'Product ad / UGC. Structure: hook (problem), product as the solution, proof (numbers, results), clear call to action at the end. Number graphics for every figure or price, callouts for benefits. Product images as full-screen cutaways when they are mentioned. 20–45 s.'
  },
  {
    id: 'interview',
    name: 'Interview',
    tagline: 'Lower thirds, citations, ton journalistique',
    format: '16:9',
    ds: 'revue',
    preset: { goal: 'inform', pace: 'balanced', zooms: 'subtle', gfx: 'light', captionStyle: 'minimal', hook: false, tone: ['sobre', 'crédible'] },
    guide: 'Interview or testimonial. Lower third with the speaker name and role in the first 10 seconds. Quote graphics for strong statements. Keep answers intact; cut the interviewer’s hesitations and off-topic passages.'
  },
  {
    id: 'vlog',
    name: 'Vlog / Storytelling',
    tagline: 'Chapitres, émotion, illustrations en plein écran',
    format: '16:9',
    ds: 'ambre',
    preset: { goal: 'entertain', pace: 'balanced', zooms: 'dynamic', gfx: 'light', captionStyle: 'karaoke', hook: true, tone: ['spontané', 'chaleureux'] },
    guide: 'Vlog or story. Tease the payoff at the start, then tell the story in chapters with short title cards. Use illustration images as full-screen cutaways to show places, objects or moments the speaker describes. Keep jokes and reactions.'
  }
]

export const getTemplate = (id: string | undefined) => TEMPLATES.find((t) => t.id === id)

export const GOALS: { id: Brief['goal']; label: string; hint: string }[] = [
  { id: 'inform', label: 'Expliquer', hint: 'Le public repart en ayant appris quelque chose' },
  { id: 'sell', label: 'Vendre', hint: 'Le public passe à l’action' },
  { id: 'entertain', label: 'Divertir', hint: 'Le public regarde jusqu’au bout' },
  { id: 'inspire', label: 'Inspirer', hint: 'Le public retient une idée forte' }
]

export const TONES = ['énergique', 'direct', 'pédagogue', 'clair', 'posé', 'sincère', 'drôle', 'convaincant', 'sobre', 'crédible', 'spontané', 'chaleureux', 'premium', 'décalé']

export const PACES: { id: Brief['pace']; label: string; hint: string; prompt: string }[] = [
  { id: 'calm', label: 'Posé', hint: 'On laisse respirer', prompt: 'Calm pace: keep pauses up to ~0.6 s when they carry meaning, average shot 6–10 s.' },
  { id: 'balanced', label: 'Équilibré', hint: 'Fluide, sans temps mort', prompt: 'Balanced pace: remove silences over ~0.35 s, average shot 3–6 s.' },
  { id: 'punchy', label: 'Nerveux', hint: 'Jump cuts serrés', prompt: 'Punchy pace: jump cuts on every breath, silences over ~0.2 s removed, average shot 1.5–3 s.' }
]

export const ZOOMS: { id: Brief['zooms']; label: string; prompt: string }[] = [
  { id: 'none', label: 'Aucun', prompt: 'No punch-in zooms at all (zooms = []).' },
  { id: 'subtle', label: 'Discrets', prompt: 'Few subtle zooms: scale 1.06–1.1, about one every 20 s.' },
  { id: 'dynamic', label: 'Dynamiques', prompt: 'Dynamic zooms: scale 1.12–1.25 on every emphasis, about one every 5–8 s.' }
]

export const GFX_LEVELS: { id: Brief['gfx']; label: string; hint: string; prompt: string }[] = [
  { id: 'none', label: 'Aucun', hint: 'Juste la vidéo et les sous-titres', prompt: 'No motion design graphics (gfx = []), except illustration images if provided.' },
  { id: 'light', label: 'Léger', hint: 'Les moments clés', prompt: 'Light motion design: one graphic every 20–30 s of edited time, only on key moments.' },
  { id: 'rich', label: 'Riche', hint: 'Titres, listes, chiffres', prompt: 'Rich motion design: one graphic every 8–15 s of edited time.' }
]

export const CAPTION_STYLES: { id: CaptionStyle; label: string; hint: string }[] = [
  { id: 'karaoke', label: 'Karaoké', hint: 'Le mot dit s’allume' },
  { id: 'pop', label: 'Pop', hint: 'Le mot dit rebondit' },
  { id: 'box', label: 'Bandeau', hint: 'Sur un fond plein' },
  { id: 'minimal', label: 'Minimal', hint: 'Discret, en bas' }
]

export function defaultBrief(templateId = 'reel'): Brief {
  const t = getTemplate(templateId) ?? TEMPLATES[0]
  return { template: t.id, audience: '', done: false, ...t.preset, tone: [...t.preset.tone] }
}

/** The brief, written for Claude. */
export function briefPrompt(b: Brief): string {
  const t = getTemplate(b.template)
  const goal = { inform: 'make the viewer learn something', sell: 'make the viewer take action (buy, sign up, click)', entertain: 'keep the viewer watching until the end', inspire: 'leave the viewer with one strong idea' }[b.goal]
  return [
    t ? `Video type: ${t.name} (${t.format}). ${t.guide}` : '',
    `Goal: ${goal}.`,
    b.audience.trim() ? `Audience: ${b.audience.trim()}.` : '',
    b.tone.length ? `Tone: ${b.tone.join(', ')} (French words).` : '',
    PACES.find((p) => p.id === b.pace)?.prompt ?? '',
    ZOOMS.find((z) => z.id === b.zooms)?.prompt ?? '',
    GFX_LEVELS.find((g) => g.id === b.gfx)?.prompt ?? '',
    b.hook ? 'Hook: the edit must start directly on a strong, intriguing line. Cut any warm-up, greeting or throat-clearing before it, and put a callout on that first line.' : ''
  ]
    .filter(Boolean)
    .join('\n')
}
