import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getSettings } from './store'
import { FFMPEG, fileExists, probe, run, THREADS, videoEncoderArgs } from './ffmpeg'
import { enqueue, notifyProject } from './jobs'
import { transcribe } from './elevenlabs'
import { emptyEdl } from '../shared/edl'
import { PEAKS_PER_SEC, type Comment, type Edl, type Illustration, type Project, type ProjectBundle, type Range, type Word } from '../shared/types'

export const root = () => getSettings().projectsDir

export function projectDir(id: string) {
  const dir = path.join(root(), id)
  if (!path.resolve(dir).startsWith(path.resolve(root()))) throw new Error('Projet invalide')
  return dir
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
  if (!p.ready.proxy)
    steps.push(
      enqueue(id, 'Proxy 540p', async (ctx) => {
        const enc = await videoEncoderArgs(2500, 26)
        const out = path.join(dir, 'proxy.mp4')
        await run(
          FFMPEG,
          ['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:540,format=yuv420p', '-r', String(Math.min(30, Math.round(p.media.fps) || 30)),
            ...enc, '-g', '15', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', out],
          { duration: dur, onProgress: (x) => ctx.progress(x) }
        )
        markReady(id, 'proxy')
      })
    )
  if (p.media.hasAudio && !p.ready.peaks)
    steps.push(
      enqueue(id, 'Forme d’onde', async (ctx) => {
        // Decode audio at 4 kHz mono and keep one peak per 20 ms.
        const rate = 4000
        const per = rate / PEAKS_PER_SEC
        const peaks: number[] = []
        let acc = 0
        let n = 0
        let carry: Buffer | null = null
        await run(FFMPEG, ['-i', src, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1'], {
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
          }
        })
        fs.writeFileSync(path.join(dir, 'peaks.bin'), Buffer.from(peaks))
        markReady(id, 'peaks')
      })
    )
  if (p.media.hasAudio && !p.ready.silences)
    steps.push(
      enqueue(id, 'Détection des silences', async (ctx) => {
        const { stderr } = await run(FFMPEG, ['-i', src, '-vn', '-af', 'silencedetect=noise=-35dB:d=0.45', '-f', 'null', '-'], {
          duration: dur,
          onProgress: ctx.progress
        })
        const sil: Range[] = []
        let start: number | null = null
        for (const l of stderr.split('\n')) {
          const s = l.match(/silence_start: ([\d.]+)/)
          const e = l.match(/silence_end: ([\d.]+)/)
          if (s) start = Number(s[1])
          if (e && start !== null) {
            sil.push({ in: start, out: Number(e[1]) })
            start = null
          }
        }
        if (start !== null) sil.push({ in: start, out: dur })
        writeJson(path.join(dir, 'silences.json'), sil)
        markReady(id, 'silences')
      })
    )
  await Promise.allSettled(steps)

  // The filmstrip reads the light proxy instead of the raw.
  if (!loadProject(id).ready.sprite && fileExists(path.join(dir, 'proxy.mp4'))) {
    await enqueue(id, 'Vignettes', async (ctx) => {
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
        { duration: dur, onProgress: ctx.progress }
      )
      const pr = loadProject(id)
      pr.sprite = { file: 'sprite.jpg', every, cols, w, h, count }
      pr.ready.sprite = true
      saveProject(pr)
      notifyProject(id)
    }).catch(() => undefined)
  }

  if (p.media.hasAudio && !loadProject(id).ready.transcript && getSettings().elevenKey) {
    await transcribeProject(id).catch(() => undefined)
  }
}

export async function transcribeProject(id: string) {
  const p = loadProject(id)
  const audio = path.join(p.dir, 'audio.mp3')
  if (!fileExists(audio)) {
    await enqueue(id, 'Extraction audio', (ctx) =>
      run(FFMPEG, ['-i', p.media.path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', audio], {
        duration: p.media.duration,
        onProgress: ctx.progress
      })
    )
  }
  await enqueue(
    id,
    'Transcription ElevenLabs',
    async () => {
      const words = await transcribe(audio)
      writeJson(path.join(p.dir, 'words.json'), words)
      markReady(id, 'transcript')
    },
    true
  )
}
