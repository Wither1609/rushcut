import Anthropic from '@anthropic-ai/sdk'
import { nativeImage } from 'electron'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import { getSettings, getDesignSystem } from './store'
import { fitToKeep, normalizeKeep, snapKeep } from '../shared/edl'
import { briefPrompt } from '../shared/templates'
import { applyOps, chapterRef, zoomRef, type EdlOp } from '../shared/ops'
import { FONT_CHOICES, type CaptionStyle, type Comment, type DesignSystem, type Edl, type GfxComp, type ProjectBundle, type Recipe } from '../shared/types'

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']

async function callJson<T>(label: string, system: string, content: BetaContentBlockParam[], schema: Record<string, unknown>, parser: z.ZodType<T>): Promise<T> {
  const s = getSettings()
  if (!s.anthropicKey) throw new Error('Ajoute ta clé Claude (Anthropic) dans Réglages.')
  const client = new Anthropic({ apiKey: s.anthropicKey })
  const fallback = FALLBACK_MODELS.includes(s.claudeModel)
  try {
    const stream = client.beta.messages.stream({
      model: s.claudeModel,
      max_tokens: 64000,
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      thinking: { type: 'adaptive' },
      output_config: { effort: s.effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }]
    })
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') throw new Error(`Claude a refusé la demande (${label}).`)
    if (msg.stop_reason === 'max_tokens') throw new Error(`Réponse de Claude tronquée (${label}). Réessaie avec un effort plus bas.`)
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    return parser.parse(JSON.parse(text))
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Clé Claude refusée. Vérifie-la dans Réglages.')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de requêtes Claude atteinte. Réessaie dans une minute.')
    if (e instanceof Anthropic.BadRequestError) throw new Error(`Requête refusée par l’API Claude : ${e.message}`)
    if (e instanceof Anthropic.APIError) throw new Error(`Erreur API Claude ${e.status ?? ''} : ${e.message}`)
    if (e instanceof z.ZodError || e instanceof SyntaxError) throw new Error(`Réponse de Claude illisible (${label}).`)
    throw e
  }
}

// ---------------------------------------------------------------------------
// Edit decision list

const GFX_COMPS: GfxComp[] = ['title', 'lowerThird', 'list', 'callout', 'number', 'quote', 'image']

const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const arr = (items: unknown) => ({ type: 'array', items })

const EDL_SCHEMA = obj({
  summary: { type: 'string', description: 'En français, 1 à 3 phrases : ce qui a été fait ou changé.' },
  keep: arr(obj({ in: { type: 'number' }, out: { type: 'number' } })),
  chapters: arr(obj({ t: { type: 'number' }, title: { type: 'string' } })),
  zooms: arr(obj({ t: { type: 'number' }, d: { type: 'number' }, scale: { type: 'number' } })),
  gfx: arr(
    obj({
      t: { type: 'number' },
      d: { type: 'number' },
      comp: { type: 'string', enum: GFX_COMPS },
      title: { type: 'string' },
      subtitle: { type: 'string' },
      text: { type: 'string' },
      items: arr({ type: 'string' }),
      image: { type: 'string', description: 'image comp only: file name of one provided illustration, else empty' },
      layout: { type: 'string', enum: ['card', 'full'] }
    })
  ),
  captions: obj({ enabled: { type: 'boolean' }, maxWords: { type: 'integer' }, uppercase: { type: 'boolean' } }),
  resolves: arr({ type: 'string' })
})

const EdlDraft = z.object({
  summary: z.string(),
  keep: z.array(z.object({ in: z.number(), out: z.number() })),
  chapters: z.array(z.object({ t: z.number(), title: z.string() })),
  zooms: z.array(z.object({ t: z.number(), d: z.number(), scale: z.number() })),
  gfx: z.array(
    z.object({
      t: z.number(),
      d: z.number(),
      comp: z.enum(GFX_COMPS as [GfxComp, ...GfxComp[]]),
      title: z.string(),
      subtitle: z.string(),
      text: z.string(),
      items: z.array(z.string()),
      image: z.string(),
      layout: z.enum(['card', 'full'])
    })
  ),
  captions: z.object({ enabled: z.boolean(), maxWords: z.number(), uppercase: z.boolean() }),
  resolves: z.array(z.string())
})
type EdlDraft = z.infer<typeof EdlDraft>

const EDITOR_SYSTEM = `You are the lead editor inside Rushcut, a video editor. You receive a word-level transcript of a talking-head raw recording and you return an edit decision list (EDL) as JSON. You never render video: the app plays and exports your EDL.

All times are seconds in the SOURCE recording.

keep — the source ranges that stay in the edit, chronological and non-overlapping.
- Remove dead air (silences longer than ~0.35 s), false starts, stutters, and repeated takes. When a sentence is said several times, keep the last complete take unless an earlier one is clearly better.
- Remove filler words ("euh", "um", "du coup" used as filler) only when the cut stays clean.
- Cut only at word boundaries: start a range about 0.08 s before its first word and end it about 0.15 s after its last word. Never cut inside a word.
- Keep the meaning and the speaker's natural rhythm. Do not reorder content.

gfx — motion design overlays, rendered with the project's design system. Times must fall inside kept ranges.
- title: section title card (title, optional subtitle). Use at the start of each main section.
- lowerThird: speaker name or topic label (title, subtitle).
- list: 2–5 short items that appear one by one (items). Use when the speaker enumerates.
- callout: one punchy keyword or short phrase (text) to emphasise what is being said.
- number: a big figure (title = the figure, subtitle = what it measures).
- quote: a short sentence worth reading on screen (text).
- image: one of the creator's illustration images (image = its file name), shown when the speaker talks about what it depicts. layout "card" frames it beside the speaker; layout "full" is a full-screen cutaway with a slow push-in (2–4 s). Use each provided image at least once when it fits the content, never invent file names. Without provided images, never use this comp.
- Durations 2.5–6 s. Unless the brief says otherwise, aim for roughly one graphic every 12–25 s of edited time, timed to the words they illustrate. Unused fields are empty strings / empty arrays, layout "card".
- On-screen text is short and written in the language of the transcript.

zooms — punch-in zooms on emphasis: scale 1.08–1.2, duration 1.5–5 s, roughly every second or third sentence. Do not stack zooms with title cards.
chapters — one per topic section, with a short title in the transcript's language.
captions — word-by-word subtitles. Default enabled, maxWords 3, uppercase true, unless the brief or instructions say otherwise.

When a <brief> is given, it comes from the creator's onboarding answers: follow its pace, zoom and graphics density over the defaults above.
resolves — ids of the review comments your EDL addresses (empty for a first cut).
summary — in French, for the editor UI.`

function transcriptBlock(b: ProjectBundle): string {
  const lines = b.words.map((w) => `${w.start.toFixed(2)}-${w.end.toFixed(2)} ${w.text}`)
  const sil = b.silences.map((s) => `${s.in.toFixed(2)}-${s.out.toFixed(2)}`).join(', ')
  return `<recording duration="${b.project.media.duration.toFixed(2)}">\n<silences>${sil}</silences>\n<transcript format="start-end word">\n${lines.join('\n')}\n</transcript>\n</recording>`
}

function contextBlock(b: ProjectBundle, ds: DesignSystem): string {
  const r = b.project.recipe
  return [
    `<design_system name="${ds.name}">${ds.note}. Background ${ds.bg}, text ${ds.fg}, accent ${ds.accent}, font ${ds.font}.</design_system>`,
    b.project.brief ? `<brief>\n${briefPrompt(b.project.brief)}\n</brief>` : '',
    b.project.notes.trim() ? `<creator_notes>\n${b.project.notes.trim()}\n</creator_notes>` : '',
    r
      ? `<reference_recipe source="${r.source}">\nMatch this editing style taken from a reference video.\nRhythm: ${r.rhythm} (average shot ${r.avgShot.toFixed(1)} s)\nZooms: ${r.zooms}\nCaptions: ${r.captions}\nGraphics: ${r.graphics}\nStructure: ${r.structure}\nSound: ${r.sound}\nSummary: ${r.summary}\n</reference_recipe>`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Each illustration as a small JPEG with its file name and the creator's label, so Claude knows what it shows. */
function illustrationBlocks(b: ProjectBundle): BetaContentBlockParam[] {
  const list = b.project.illustrations ?? []
  if (!list.length) return []
  const out: BetaContentBlockParam[] = [{ type: 'text', text: `<illustrations count="${list.length}">The creator provided these images for image graphics.</illustrations>` }]
  for (const il of list.slice(0, 16)) {
    const img = nativeImage.createFromPath(path.join(b.project.dir, 'assets', il.file))
    if (img.isEmpty()) continue
    const { width } = img.getSize()
    const jpg = (width > 640 ? img.resize({ width: 640, quality: 'good' }) : img).toJPEG(80)
    out.push({ type: 'text', text: `<illustration file="${il.file}">${il.label}</illustration>` })
    out.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } })
  }
  return out
}

function toEdl(d: EdlDraft, b: ProjectBundle, version: string, parent: string | null, ds: string, captionStyle?: CaptionStyle): Edl {
  const dur = b.project.media.duration
  const images = new Set((b.project.illustrations ?? []).map((i) => i.file))
  // Claude is asked to cut between words; this makes sure of it.
  const snapped = snapKeep(normalizeKeep(d.keep, dur), b.words, dur)
  const keep = snapped.length ? snapped : [{ in: 0, out: dur }]
  return {
    version,
    parent,
    createdAt: new Date().toISOString(),
    status: 'review',
    origin: 'claude',
    designSystem: ds,
    summary: d.summary,
    keep,
    chapters: d.chapters.filter((c) => c.t >= 0 && c.t <= dur).sort((a, c) => a.t - c.t),
    zooms: fitToKeep(
      d.zooms
        .filter((z) => z.t >= 0 && z.t < dur && z.d > 0.3)
        .map((z) => ({ t: z.t, d: Math.min(z.d, 8), scale: Math.min(1.35, Math.max(1.02, z.scale)) })),
      keep,
      0.3
    ),
    gfx: fitToKeep(
      d.gfx
        .filter((g) => g.t >= 0 && g.t < dur && g.d > 0.5)
        .filter((g) => g.comp !== 'image' || images.has(g.image))
        .map((g, i) => ({
          id: `g${Date.now().toString(36)}${i}`,
          t: g.t,
          d: Math.min(g.d, 12),
          comp: g.comp,
          props:
            g.comp === 'image'
              ? { src: g.image, layout: g.layout, title: g.title, subtitle: g.subtitle }
              : { title: g.title, subtitle: g.subtitle, text: g.text, items: g.items.filter(Boolean).slice(0, 6) }
        })),
      keep,
      0.5
    ),
    captions: {
      enabled: d.captions.enabled,
      maxWords: Math.min(8, Math.max(1, Math.round(d.captions.maxWords))),
      uppercase: d.captions.uppercase,
      style: captionStyle ?? b.project.brief?.captionStyle ?? 'karaoke'
    },
    resolves: d.resolves
  }
}

export async function generateFirstCut(b: ProjectBundle, version: string, dsId: string): Promise<Edl> {
  if (!b.words.length) throw new Error('Il faut un transcript avant de générer la V1 (ajoute ta clé ElevenLabs).')
  const ds = getDesignSystem(dsId)
  const draft = await callJson(
    'V1',
    EDITOR_SYSTEM,
    [
      { type: 'text', text: transcriptBlock(b), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: contextBlock(b, ds) || 'No extra context.' },
      ...illustrationBlocks(b),
      { type: 'text', text: 'Produce the first cut (V1) of this recording.' }
    ],
    EDL_SCHEMA,
    EdlDraft
  )
  return toEdl(draft, b, version, null, dsId)
}

function nearWords(b: ProjectBundle, t: number) {
  return b.words
    .filter((w) => w.end > t - 2.5 && w.start < t + 2.5)
    .map((w) => w.text)
    .join(' ')
}

// Revisions are edits on the previous version, not a new EDL: what the review did not mention cannot move.

const num = { type: 'number' }
const str = { type: 'string' }
const opt = (op: string, properties: Record<string, unknown> = {}) => obj({ op: { type: 'string', enum: [op] }, ...properties })
const gfxFields = { t: num, d: num, comp: { type: 'string', enum: GFX_COMPS }, title: str, subtitle: str, text: str, items: arr(str), image: str, layout: { type: 'string', enum: ['card', 'full'] } }

const OPS_SCHEMA = obj({
  summary: { type: 'string', description: 'En français, 1 à 3 phrases : ce qui a changé par rapport à la version précédente.' },
  ops: arr({
    anyOf: [
      opt('cut', { a: num, b: num }),
      opt('restore', { a: num, b: num }),
      opt('gfx_add', gfxFields),
      opt('gfx_update', { ref: str, ...gfxFields }),
      opt('gfx_remove', { ref: str }),
      opt('zoom_add', { t: num, d: num, scale: num }),
      opt('zoom_update', { ref: str, t: num, d: num, scale: num }),
      opt('zoom_remove', { ref: str }),
      opt('chapter_add', { t: num, title: str }),
      opt('chapter_update', { ref: str, t: num, title: str }),
      opt('chapter_remove', { ref: str }),
      opt('captions', { enabled: { type: 'boolean' }, maxWords: { type: 'integer' }, uppercase: { type: 'boolean' } })
    ]
  }),
  resolves: arr(str)
})

const zGfx = { t: z.number(), d: z.number(), comp: z.enum(GFX_COMPS as [GfxComp, ...GfxComp[]]), title: z.string(), subtitle: z.string(), text: z.string(), items: z.array(z.string()), image: z.string(), layout: z.enum(['card', 'full']) }
const zRef = { ref: z.string() }
const OpsDraft = z.object({
  summary: z.string(),
  ops: z.array(
    z.discriminatedUnion('op', [
      z.object({ op: z.literal('cut'), a: z.number(), b: z.number() }),
      z.object({ op: z.literal('restore'), a: z.number(), b: z.number() }),
      z.object({ op: z.literal('gfx_add'), ...zGfx }),
      z.object({ op: z.literal('gfx_update'), ...zRef, ...zGfx }),
      z.object({ op: z.literal('gfx_remove'), ...zRef }),
      z.object({ op: z.literal('zoom_add'), t: z.number(), d: z.number(), scale: z.number() }),
      z.object({ op: z.literal('zoom_update'), ...zRef, t: z.number(), d: z.number(), scale: z.number() }),
      z.object({ op: z.literal('zoom_remove'), ...zRef }),
      z.object({ op: z.literal('chapter_add'), t: z.number(), title: z.string() }),
      z.object({ op: z.literal('chapter_update'), ...zRef, t: z.number(), title: z.string() }),
      z.object({ op: z.literal('chapter_remove'), ...zRef }),
      z.object({ op: z.literal('captions'), enabled: z.boolean(), maxWords: z.number(), uppercase: z.boolean() })
    ])
  ),
  resolves: z.array(z.string())
})

const REVISE_INSTRUCTIONS = `You now revise an existing edit. Do not return a full EDL: return the list of ops that turn the current EDL into the new version. Anything you do not touch stays exactly as it is.

ops (applied in order):
- cut {a, b}: remove the source range a–b from the edit. Cut between words: a ≈ 0.15 s after the last word you keep, b ≈ 0.08 s before the next word you keep. The app snaps both ends onto word boundaries.
- restore {a, b}: bring back a removed source range.
- gfx_add {t, d, comp, …}: new graphic. gfx_update {ref, …all fields}: replace an existing graphic (send every field, changed or not). gfx_remove {ref}.
- zoom_add {t, d, scale}, zoom_update {ref, t, d, scale}, zoom_remove {ref}.
- chapter_add {t, title}, chapter_update {ref, t, title}, chapter_remove {ref}.
- captions {enabled, maxWords, uppercase}: only if a comment is about captions.
ref is the id shown in the current EDL (graphics: their id; zooms: z0, z1…; chapters: c0, c1…). Times are source seconds.
A comment about something the EDL cannot do (colour grading, sound, re-recording…) gets no op: leave it out of resolves and explain it in the summary.`

export async function applyComments(b: ProjectBundle, base: Edl, open: Comment[], version: string, dsId: string): Promise<Edl> {
  const ds = getDesignSystem(dsId)
  const content: BetaContentBlockParam[] = [
    { type: 'text', text: transcriptBlock(b), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextBlock(b, ds) || 'No extra context.' },
    ...illustrationBlocks(b),
    {
      type: 'text',
      text: `<current_edl version="${base.version}">\n${JSON.stringify({
        keep: base.keep,
        chapters: base.chapters.map((c, i) => ({ ref: chapterRef(i), ...c })),
        zooms: base.zooms.map((z, i) => ({ ref: zoomRef(i), ...z })),
        gfx: base.gfx.map(({ id, t, d, comp, props: { src, ...props } }) => ({ ref: id, t, d, comp, ...props, ...(src ? { image: src } : {}) })),
        captions: base.captions
      })}\n</current_edl>`
    }
  ]
  // Each comment comes with the frame the reviewer saw, drawing included (images capped to keep the request small).
  open.forEach((c, i) => {
    const f = i < 20 && c.frame ? path.join(b.project.dir, 'comments', c.frame) : null
    const img = f && fs.existsSync(f)
    content.push({
      type: 'text',
      text: `<comment id="${c.id}" t="${c.t.toFixed(2)}">\n${c.text}\nWords around this moment: "${nearWords(b, c.t)}"${
        c.sketch.length && img ? `\nThe reviewer drew ${c.sketch.map((s) => s.tool).join(', ')} on the frame below to point at what they mean.` : ''
      }\n</comment>`
    })
    if (img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } })
  })
  content.push({
    type: 'text',
    text: `Produce ${version}: return the ops that apply every review comment above to the current EDL (${base.version}). Change only what the comments ask for, plus what those changes require. List the comment ids you addressed in resolves.`
  })
  const draft = await callJson(version, `${EDITOR_SYSTEM}\n\n${REVISE_INSTRUCTIONS}`, content, OPS_SCHEMA, OpsDraft)
  const ops = draft.ops as EdlOp[]
  const r = applyOps(base, ops, b.words, b.project.media.duration, (b.project.illustrations ?? []).map((i) => i.file))
  const ids = new Set(open.map((c) => c.id))
  return {
    ...r.edl,
    version,
    parent: base.version,
    createdAt: new Date().toISOString(),
    status: 'review',
    origin: 'claude',
    designSystem: dsId,
    summary: draft.summary + (r.skipped.length ? ` (${r.skipped.length} modification${r.skipped.length > 1 ? 's' : ''} ignorée${r.skipped.length > 1 ? 's' : ''} : ${r.skipped.join(' ; ')})` : ''),
    resolves: draft.resolves.filter((id) => ids.has(id)),
    ops
  }
}

// ---------------------------------------------------------------------------
// Reference video → editing recipe

const RECIPE_SCHEMA = obj({
  summary: { type: 'string' },
  rhythm: { type: 'string' },
  zooms: { type: 'string' },
  captions: { type: 'string' },
  graphics: { type: 'string' },
  structure: { type: 'string' },
  sound: { type: 'string' }
})
const RecipeDraft = z.object({
  summary: z.string(),
  rhythm: z.string(),
  zooms: z.string(),
  captions: z.string(),
  graphics: z.string(),
  structure: z.string(),
  sound: z.string()
})

export async function analyzeReference(source: string, duration: number, shots: number[], frames: { t: number; jpg: Buffer }[]): Promise<Recipe> {
  const avg = shots.length ? shots.reduce((a, s) => a + s, 0) / shots.length : duration
  const content: BetaContentBlockParam[] = [
    {
      type: 'text',
      text: `Reference video: ${duration.toFixed(1)} s, ${shots.length} shots, average shot ${avg.toFixed(2)} s.\nShot lengths (s): ${shots.map((s) => s.toFixed(2)).join(', ')}\nKeyframes follow, in order, with their timestamps.`
    }
  ]
  for (const f of frames) {
    content.push({ type: 'text', text: `t=${f.t.toFixed(2)}s` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.jpg.toString('base64') } })
  }
  content.push({
    type: 'text',
    text: 'Describe this video’s editing style as a recipe another editor can apply to a different raw recording. Be concrete (numbers, frequencies, placement, colours, type). Write every field in French, one or two sentences each.'
  })
  const d = await callJson(
    'analyse de l’exemple',
    'You are a senior video editor who reverse-engineers editing styles from reference videos.',
    content,
    RECIPE_SCHEMA,
    RecipeDraft
  )
  return { ...d, source, avgShot: avg, shots }
}

// ---------------------------------------------------------------------------
// Screenshot / deck / website capture → design system

const DS_SCHEMA = obj({
  name: { type: 'string' },
  note: { type: 'string' },
  bg: { type: 'string', description: 'hex colour #rrggbb' },
  fg: { type: 'string', description: 'hex colour #rrggbb' },
  accent: { type: 'string', description: 'hex colour #rrggbb' },
  font: { type: 'string', enum: FONT_CHOICES },
  weight: { type: 'integer' },
  radius: { type: 'integer' }
})
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const DsDraft = z.object({ name: z.string(), note: z.string(), bg: hex, fg: hex, accent: hex, font: z.string(), weight: z.number(), radius: z.number() })

export async function designSystemFromImage(file: string): Promise<DesignSystem> {
  const ext = path.extname(file).toLowerCase()
  const media_type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  const d = await callJson(
    'design system',
    'You are a brand designer. You extract a compact design system for video motion graphics from an image.',
    [
      { type: 'image', source: { type: 'base64', media_type, data: fs.readFileSync(file).toString('base64') } },
      {
        type: 'text',
        text: `Extract a design system for on-video graphics (title cards, lower thirds, captions) from this image: panel background colour, text colour, one accent colour, the closest font among ${FONT_CHOICES.join(', ')}, a font weight (400–900) and a corner radius in px at 1080p (0–24). Name it after the brand or style; note = 2–4 words in French describing the feel.`
      }
    ],
    DS_SCHEMA,
    DsDraft
  )
  return {
    id: `ds-${Date.now().toString(36)}`,
    name: d.name,
    note: d.note,
    bg: d.bg,
    fg: d.fg,
    accent: d.accent,
    font: FONT_CHOICES.includes(d.font) ? d.font : FONT_CHOICES[0],
    weight: Math.round(Math.min(900, Math.max(400, d.weight)) / 100) * 100,
    radius: Math.min(32, Math.max(0, Math.round(d.radius)))
  }
}
