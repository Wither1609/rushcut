// Shared data model. All times are in seconds of the SOURCE (raw) video.
// The edited output is the concatenation of `keep` ranges; export maps source time to output time.

import type { EdlOp } from './ops'

export interface Word {
  text: string
  start: number
  end: number
}

export interface Range {
  in: number
  out: number
}

export type GfxComp = 'title' | 'lowerThird' | 'list' | 'callout' | 'number' | 'quote' | 'image'

export interface GfxItem {
  id: string
  t: number
  d: number
  comp: GfxComp
  props: {
    title?: string
    subtitle?: string
    items?: string[]
    text?: string
    /** image: file name in the project's assets/ folder. */
    src?: string
    /** image: framed card over the speaker, or full-screen cutaway. */
    layout?: 'card' | 'full'
  }
}

export interface Zoom {
  t: number
  d: number
  scale: number
}

export interface Chapter {
  t: number
  title: string
}

export interface Edl {
  version: string // "V1", "V2"…
  parent: string | null
  createdAt: string
  status: 'review' | 'approved' | 'archived'
  origin: 'claude' | 'manual'
  designSystem: string
  summary: string // changelog written by Claude
  keep: Range[]
  chapters: Chapter[]
  zooms: Zoom[]
  gfx: GfxItem[]
  captions: { enabled: boolean; maxWords: number; uppercase: boolean; style?: CaptionStyle }
  resolves: string[]
  /** For a revision: the edits Claude applied to `parent` to get this version. */
  ops?: EdlOp[]
}

export type ShapeTool = 'pen' | 'ellipse' | 'arrow' | 'rect'

export interface Shape {
  tool: ShapeTool
  color: string
  pts?: [number, number][] // pen, normalized 0..1
  a?: [number, number]
  b?: [number, number]
}

export interface Comment {
  id: string
  t: number
  text: string
  sketch: Shape[]
  frame?: string // file name of the JPEG snapshot (frame + sketch) in comments/
  createdIn: string // version the comment was made on
  /** The drawing was made on the vertical preview: its coordinates are relative to the 9:16 frame. */
  aspect?: '9:16'
  fixedIn?: string
  createdAt: string
}

export type CaptionStyle = 'karaoke' | 'pop' | 'box' | 'minimal'

/** An image the creator added to the project (logo, product shot, b-roll still…), stored in assets/. */
export interface Illustration {
  file: string
  label: string
}

/** Answers from the onboarding questions, read by Claude before the first cut. */
export interface Brief {
  template: string
  goal: 'inform' | 'sell' | 'entertain' | 'inspire'
  audience: string
  tone: string[]
  pace: 'calm' | 'balanced' | 'punchy'
  zooms: 'none' | 'subtle' | 'dynamic'
  gfx: 'none' | 'light' | 'rich'
  captionStyle: CaptionStyle
  hook: boolean
  done: boolean
}

export interface Recipe {
  source: string
  avgShot: number
  shots: number[]
  summary: string
  rhythm: string
  zooms: string
  captions: string
  graphics: string
  structure: string
  sound: string
}

export interface MediaInfo {
  path: string
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
}

/** Error message of a job the user cancelled: shown as a plain notice, not as a failure. */
export const CANCELLED = 'Tâche annulée'

export interface JobState {
  id: string
  label: string
  progress: number // 0..1, -1 = indeterminate
  status: 'queued' | 'running' | 'done' | 'error'
  error?: string
}

export interface Project {
  id: string
  name: string
  dir: string
  createdAt: string
  media: MediaInfo
  ready: { proxy: boolean; peaks: boolean; sprite: boolean; transcript: boolean; silences: boolean }
  sprite?: { file: string; every: number; cols: number; w: number; h: number; count: number }
  versions: string[]
  current: string | null
  notes: string
  designSystem: string
  recipe?: Recipe
  brief?: Brief
  illustrations?: Illustration[]
  /** Output framing chosen in the player or the export dialog (see shared/frame.ts). */
  frame?: { aspect: 'source' | '9:16'; cropX: number }
}

export interface ProjectBundle {
  project: Project
  words: Word[]
  silences: Range[]
  peaks: number[] // 0..255, PEAKS_PER_SEC per second
  edls: Record<string, Edl>
  comments: Comment[]
}

export const PEAKS_PER_SEC = 50

export interface DesignSystem {
  id: string
  name: string
  note: string
  bg: string
  fg: string
  accent: string
  font: string
  weight: number
  radius: number
  builtin?: boolean
}

/** How Rushcut reaches Claude: an API key, or the Claude Code CLI signed in with a Pro/Max subscription. */
export type ClaudeAuth = 'api' | 'subscription'

export interface Settings {
  claudeAuth: ClaudeAuth
  anthropicKey: string
  /** Claude Code executable; empty = found automatically. */
  claudePath: string
  elevenKey: string
  claudeModel: string
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  scribeModel: string
  projectsDir: string
}

export interface PublicSettings {
  claudeAuth: ClaudeAuth
  claudePath: string
  hasAnthropicKey: boolean
  hasElevenKey: boolean
  claudeModel: string
  effort: Settings['effort']
  scribeModel: string
  projectsDir: string
}

export interface ClaudeCodeStatus {
  installed: boolean
  path?: string
  version?: string
  loggedIn: boolean
  authMethod?: string
  email?: string
  plan?: string
}

export interface ExportOptions {
  version: string
  /** Short side of the output: 1080 gives 1920×1080 in 16:9 and 1080×1920 in 9:16. */
  height: 720 | 1080 | 2160
  burnCaptions: boolean
  /** 'source' keeps the rush's framing; '9:16' crops it to vertical for Reels, TikTok and Shorts. */
  aspect?: 'source' | '9:16'
  /** 9:16 only: horizontal position of the crop, 0 = left edge, 0.5 = centre, 1 = right edge. */
  cropX?: number
  /** Also write a .srt subtitle file next to the video. */
  srt?: boolean
}

export const BUILTIN_DS: DesignSystem[] = [
  { id: 'ambre', name: 'Studio Ambre', note: 'chaud, contrasté', bg: '#17120d', fg: '#fff5e8', accent: '#ff7a1a', font: 'Bricolage Grotesque', weight: 800, radius: 10, builtin: true },
  { id: 'carte', name: 'Carte blanche', note: 'reels, très lisible', bg: '#efeeec', fg: '#141414', accent: '#2d9cff', font: 'Archivo Black', weight: 400, radius: 14, builtin: true },
  { id: 'nuit', name: 'Bleu nuit', note: 'tech', bg: '#0b1020', fg: '#e8edff', accent: '#7cf2c8', font: 'JetBrains Mono', weight: 700, radius: 6, builtin: true },
  { id: 'revue', name: 'Revue', note: 'éditorial', bg: '#1f2a24', fg: '#f4f1e8', accent: '#e9c46a', font: 'Instrument Serif', weight: 400, radius: 2, builtin: true }
]

export const FONT_CHOICES = ['Bricolage Grotesque', 'Archivo Black', 'JetBrains Mono', 'Instrument Serif', 'Figtree']
