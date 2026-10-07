import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getSettings } from './store'
import { FFMPEG, fileExists, probe, run, runDecoding, THREADS, videoEncoderArgs } from './ffmpeg'
import { enqueue, notifyProject, throwIfCancelled, type JobCtx } from './jobs'
import { transcribe } from './elevenlabs'
import { emptyEdl } from '../shared/edl'
import { PEAKS_PER_SEC, type Comment, type Edl, type Illustration, type Project, type ProjectBundle, type Range, type Word } from '../shared/types'

export const root = () => getSettings().projectsDir

/** Project ids are a single folder name (see createProject): anything else could point outside the projects folder. */
export function projectDir(id: string) {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Projet invalide')
  return path.join(root(), id)
}

const readJson = <T>(p: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T
  } catch {
    return fallback
  }
}
const writeJson = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1))
  fs.renameSync(tmp, p)
}

export function loadProject(id: string): Project {
  const p = readJson<Project | null>(path.join(projectDir(id), 'project.json'), null)
  if (!p) throw new Error('Projet introuvable')
  p.dir = projectDir(id)
  return p
}

export function saveProject(p: Project) {
  writeJson(path.join(projectDir(p.id), 'project.json'), p)
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'notes' | 'designSystem' | 'current' | 'recipe' | 'brief' | 'illustrations'>>) {
  const p = { ...loadProject(id), ...patch }
  saveProject(p)
  return p
}

export function listProjects(): Project[] {
  const r = root()
  if (!fs.existsSync(r)) return []
  return fs
    .readdirSync(r)
    .map((d) => readJson<Project | null>(path.join(r, d, 'project.json'), null))
    .filter((p): p is Project => !!p)
    .map((p) => ({ ...p, dir: path.join(r, p.id) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function loadBundle(id: string): ProjectBundle {
  const project = loadProject(id)
  const dir = project.dir
  const edls: Record<string, Edl> = {}
  for (const v of project.versions) {
    const e = readJson<Edl | null>(path.join(dir, 'edl', `${v}.json`), null)
    if (e) edls[v] = e
  }
  let peaks: number[] = []
  try {
    peaks = [...fs.readFileSync(path.join(dir, 'peaks.bin'))]
  } catch {
    /* not ready */
  }
  return {
    project,
    words: readJson<Word[]>(path.join(dir, 'words.json'), []),
    silences: readJson<Range[]>(path.join(dir, 'silences.json'), []),
    peaks,
    edls,
    comments: readJson<Comment[]>(path.join(dir, 'comments.json'), [])
  }
}

export function saveEdl(id: string, edl: Edl) {
  const p = loadProject(id)
  writeJson(path.join(p.dir, 'edl', `${edl.version}.json`), edl)
  if (!p.versions.includes(edl.version)) {
    p.versions.push(edl.version)
    p.current = edl.version
    saveProject(p)
  }
}

export function nextVersionName(p: Project) {
  const n = p.versions.map((v) => Number(v.slice(1))).filter(Number.isFinite)
  return 'V' + ((n.length ? Math.max(...n) : 0) + 1)
}

/** The corrected transcript. Timings come from the transcription and must stay sound: ordered, finite, non-empty text. */
export function saveWords(id: string, words: Word[]) {
  const valid =
    Array.isArray(words) &&
    words.every((w, i) => typeof w?.text === 'string' && w.text.trim() !== '' && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start && (i === 0 || w.start >= words[i - 1].start))
  if (!valid) throw new Error('Transcript invalide : correction non enregistrée.')
  writeJson(path.join(projectDir(id), 'words.json'), words.map(({ text, start, end }) => ({ text: text.trim(), start, end })))
}

export function saveComments(id: string, comments: Comment[]) {
  writeJson(path.join(projectDir(id), 'comments.json'), comments)
}

export function saveCommentFrame(id: string, commentId: string, dataUrl: string): string {
  const name = `${commentId}.jpg`
  const dir = path.join(projectDir(id), 'comments')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), Buffer.from(dataUrl.split(',')[1], 'base64'))
  return name
}

// ---------------------------------------------------------------------------
// Illustration images: copied into assets/ so the project stays self-contained.

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

export function addIllustrations(id: string, files: string[]): Illustration[] {
  const p = loadProject(id)
  const dir = path.join(p.dir, 'assets')
  fs.mkdirSync(dir, { recursive: true })
  const list = [...(p.illustrations ?? [])]
  for (const f of files) {
    const ext = path.extname(f).toLowerCase()
    if (!IMAGE_EXT.includes(ext)) continue
    const base = path.basename(f, path.extname(f))
    const file = `${base.replace(/[^\w-]+/g, '-').slice(0, 40)}-${crypto.randomBytes(2).toString('hex')}${ext}`
    fs.copyFileSync(f, path.join(dir, file))
    list.push({ file, label: base.replace(/[-_]+/g, ' ').trim() })
  }
  return updateProject(id, { illustrations: list }).illustrations ?? []
}

export function removeIllustration(id: string, file: string): Illustration[] {
  const p = loadProject(id)
  fs.rmSync(path.join(p.dir, 'assets', path.basename(file)), { force: true })
  return updateProject(id, { illustrations: (p.illustrations ?? []).filter((i) => i.file !== file) }).illustrations ?? []
}

export function deleteProject(id: string) {
  fs.rmSync(projectDir(id), { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Import pipeline. Everything here runs once per raw file.

export async function createProject(file: string): Promise<Project> {
  const media = await probe(file)
  const base = path.basename(file, path.extname(file))
  const id = `${base.replace(/[^\w-]+/g, '-').slice(0, 40)}-${crypto.randomBytes(3).toString('hex')}`
  const dir = path.join(root(), id)
  fs.mkdirSync(path.join(dir, 'edl'), { recursive: true })
  const project: Project = {
    id,
    name: base,
    dir,
    createdAt: new Date().toISOString(),
    media,
    ready: { proxy: false, peaks: false, sprite: false, transcript: false, silences: false },
    versions: ['V0'],
    current: 'V0',
    notes: '',
    designSystem: 'ambre'
  }
  saveProject(project)
  // V0 is the untouched raw: the editor works right away, before any AI step.
  writeJson(path.join(dir, 'edl', 'V0.json'), { ...emptyEdl(media.duration, 'V0', 'ambre'), summary: 'Rush brut, sans montage.' })
  void runImportPipeline(id)
  return project
}

function markReady(id: string, key: keyof Project['ready']) {
  const p = loadProject(id)
  p.ready[key] = true
  saveProject(p)
  notifyProject(id)
}

export async function runImportPipeline(id: string) {
  const p = loadProject(id)
  const src = p.media.path
  const dir = p.dir
  const dur = p.media.duration

  const steps: Promise<unknown>[] = []
  const needTranscript = p.media.hasAudio && !p.ready.transcript && !!getSettings().elevenKey
  const needAnalysis = p.media.hasAudio && !(p.ready.peaks && p.ready.silences)
  // Audio first: the transcript is what the V1 waits for, and ElevenLabs works on it while the proxy encodes.
  if (needTranscript || needAnalysis) steps.push(extractAudio(id))
  if (needTranscript) steps.push(transcribeProject(id).catch(() => undefined))
  // Waveform and silences come from the small audio file, in one pass, instead of two more reads of the raw.
  if (needAnalysis) steps.push(enqueue(id, 'Forme d’onde et silences', (ctx) => analyzeAudio(id, ctx)))
  if (!p.ready.proxy)
    steps.push(
      enqueue(id, 'Proxy 540p', async (ctx) => {
        const enc = await videoEncoderArgs(2500, 26)
        // Written aside and renamed once complete: an interrupted encode must never pass for a proxy.
        const out = path.join(dir, 'proxy.part.mp4')
        try {
          await runDecoding(
            ['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:540,format=yuv420p', '-r', String(Math.min(30, Math.round(p.media.fps) || 30)),
              ...enc, '-g', '15', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', out],
            { duration: dur, onProgress: (x) => ctx.progress(x), signal: ctx.signal }
          )
          throwIfCancelled(ctx.signal)
          fs.renameSync(out, path.join(dir, 'proxy.mp4'))
        } finally {
          fs.rmSync(out, { force: true })
        }
        markReady(id, 'proxy')
      })
    )
  // The filmstrip reads the light proxy instead of the raw. Queued after it, so it is ready by then.
  if (!p.ready.sprite)
    steps.push(
      enqueue(id, 'Vignettes', async (ctx) => {
        if (!loadProject(id).ready.proxy) return
        const every = Math.max(1, Math.ceil(dur / 240))
        const count = Math.max(1, Math.ceil(dur / every))
        const cols = 16
        const rows = Math.ceil(count / cols)
        const w = 160
        const h = Math.round((w * p.media.height) / p.media.width / 2) * 2
        await run(
          FFMPEG,
          ['-skip_frame', 'nokey', '-i', path.join(dir, 'proxy.mp4'), '-an', '-vf', `fps=1/${every},scale=${w}:${h},tile=${cols}x${rows}`,
            '-frames:v', '1', '-q:v', '5', '-threads', THREADS, path.join(dir, 'sprite.jpg')],
          { duration: dur, onProgress: ctx.progress, signal: ctx.signal }
        )
        const pr = loadProject(id)
        pr.sprite = { file: 'sprite.jpg', every, cols, w, h, count }
        pr.ready.sprite = true
        saveProject(pr)
        notifyProject(id)
      })
    )
  await Promise.allSettled(steps)
}

const audioJobs = new Map<string, Promise<string>>()

/** The 16 kHz mono mp3 sent to ElevenLabs, also the source of the waveform and the silences. One read of the raw. */
function extractAudio(id: string): Promise<string> {
  const p = loadProject(id)
  const audio = path.join(p.dir, 'audio.mp3')
  if (fileExists(audio)) return Promise.resolve(audio)
  let job = audioJobs.get(id)
  if (!job) {
    job = enqueue(id, 'Extraction audio', async (ctx) => {
      const tmp = path.join(p.dir, 'audio.part.mp3')
      await run(FFMPEG, ['-i', p.media.path, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', tmp], {
        duration: p.media.duration,
        onProgress: ctx.progress,
        signal: ctx.signal
      })
      fs.renameSync(tmp, audio)
      return audio
    }).finally(() => audioJobs.delete(id))
    audioJobs.set(id, job)
  }
  return job
}

async function analyzeAudio(id: string, ctx: JobCtx) {
  const p = loadProject(id)
  const dur = p.media.duration
  const audio = path.join(p.dir, 'audio.mp3')
  // Decode at 4 kHz mono and keep one peak per 20 ms; silencedetect runs on a branch of the same decode.
  const rate = 4000
  const per = rate / PEAKS_PER_SEC
  const peaks: number[] = []
  let acc = 0
  let n = 0
  let carry: Buffer | null = null
  const sil: Range[] = []
  let start: number | null = null
  await run(
    FFMPEG,
    ['-nostats', '-i', fileExists(audio) ? audio : p.media.path, '-filter_complex', '[0:a:0]asplit=2[p][s];[s]silencedetect=noise=-35dB:d=0.45[sd]',
      '-map', '[p]', '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1', '-map', '[sd]', '-f', 'null', '-'],
    {
      onStdout: (chunk) => {
        const b: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk
        const even = b.length - (b.length % 2)
        carry = even < b.length ? b.subarray(even) : null
        for (let i = 0; i < even; i += 2) {
          const v = Math.abs(b.readInt16LE(i))
          if (v > acc) acc = v
          if (++n === per) {
            peaks.push(Math.min(255, Math.round(Math.sqrt(acc / 32768) * 255)))
            acc = 0
            n = 0
          }
        }
        ctx.progress(Math.min(1, peaks.length / PEAKS_PER_SEC / dur))
      },
      onStderrLine: (l) => {
        const s = l.match(/silence_start: ([\d.]+)/)
        const e = l.match(/silence_end: ([\d.]+)/)
        if (s) start = Number(s[1])
        if (e && start !== null) {
          sil.push({ in: start, out: Number(e[1]) })
          start = null
        }
      },
      signal: ctx.signal
    }
  )
  if (start !== null) sil.push({ in: start, out: dur })
  fs.writeFileSync(path.join(p.dir, 'peaks.bin'), Buffer.from(peaks))
  writeJson(path.join(p.dir, 'silences.json'), sil)
  markReady(id, 'peaks')
  markReady(id, 'silences')
}

export async function transcribeProject(id: string) {
  const audio = await extractAudio(id)
  await enqueue(
    id,
    'Transcription ElevenLabs',
    async (ctx) => {
      const words = await transcribe(audio, ctx.signal)
      writeJson(path.join(loadProject(id).dir, 'words.json'), words)
      markReady(id, 'transcript')
    },
    true
  )
}
