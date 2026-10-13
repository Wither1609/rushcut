import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { pipeline } from 'stream/promises'
import { events } from './jobs'
import { handlers, MIME, resolveMediaFile } from './media'
import { listProjects, root } from './projects'
import { getSettings } from './store'
import type { Project } from '../shared/types'

// Server mode: Rushcut runs without a window (Docker, behind Work OS) and the editor is a web page.
// The page calls the same handlers as the desktop window, over HTTP:
//   POST /api/call/<channel>   JSON array of arguments → { ok, value } | { ok: false, error }
//   GET  /api/events           server-sent events: jobs, project-updated
//   POST /api/upload?name=     raw file body → { path } (rushes, images: the server has no file dialog)
//   GET  /media/<project>/<file>, GET /download?path=   project files, with byte ranges
//   GET  /api/health, /api/projects   read by Work OS (src/lib/wither.ts)

export const SERVER = process.env.RUSHCUT_SERVER === '1'
export const DATA_DIR = path.resolve(process.env.RUSHCUT_DATA_DIR ?? 'data')
// Keys of the Wither/Rushcut .env (ElevenLabs…), mounted read-only in the container.
const ENV_FILE = process.env.RUSHCUT_ENV_FILE
if (SERVER && ENV_FILE && fs.statSync(ENV_FILE, { throwIfNoEntry: false })?.isFile()) process.loadEnvFile(ENV_FILE)
const PORT = Number(process.env.PORT ?? 8787)
const STATIC = path.join(__dirname, '../renderer')
const UPLOADS = () => path.join(DATA_DIR, 'uploads')
const STATIC_MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', ...MIME }

function json(res: http.ServerResponse, status: number, v: unknown) {
  const body = JSON.stringify(v)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readBody(req: http.IncomingMessage, limit = 64 * 1024 * 1024): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length
    if (size > limit) throw new Error('Requête trop volumineuse')
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Streams a file, with byte ranges so the video can seek. */
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, extra: Record<string, string> = {}) {
  let size: number
  try {
    const st = fs.statSync(file)
    if (!st.isFile()) throw new Error()
    size = st.size
  } catch {
    res.writeHead(404).end('not found')
    return
  }
  const type = STATIC_MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', ...extra }
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (range && size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) })
    fs.createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { ...head, 'Content-Length': String(size) })
  fs.createReadStream(file).pipe(res)
}

/** A project as Work OS lists it (WitherProject in src/lib/wither.ts). */
function forWorkOs(p: Project) {
  const r = p.ready
  const status = !r.proxy ? 'ingesting' : p.media.hasAudio && !r.transcript && !!getSettings().elevenKey ? 'transcribing' : 'ready'
  return {
    id: p.id,
    code: p.current ?? 'V0',
    title: p.name,
    createdAt: p.createdAt,
    reels: p.versions.filter((v) => v !== 'V0').length,
    status,
    format: p.frame?.aspect === '9:16' ? '9:16' : `${p.media.width}×${p.media.height}`
  }
}

async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? '/', 'http://local')
  const p = u.pathname

  if (p === '/api/health') {
    const s = getSettings()
    return json(res, 200, { ok: true, app: 'rushcut', model: s.claudeModel, claudeAuth: s.claudeAuth, whisper: !!s.elevenKey, transcription: s.elevenKey ? 'elevenlabs' : null })
  }
  if (p === '/api/projects') return json(res, 200, listProjects().map(forWorkOs))

  if (p.startsWith('/api/call/') && req.method === 'POST') {
    const fn = handlers.get(decodeURIComponent(p.slice('/api/call/'.length)))
    if (!fn) return json(res, 404, { ok: false, error: 'Action inconnue' })
    try {
      const raw = await readBody(req)
      const args = raw ? (JSON.parse(raw) as unknown[]) : []
      return json(res, 200, { ok: true, value: (await fn(...(Array.isArray(args) ? args : []))) ?? null })
    } catch (e) {
      return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const send = (event: string) => (data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const onJobs = send('jobs')
    const onProject = send('project-updated')
    events.on('jobs', onJobs)
    events.on('project-updated', onProject)
    const ping = setInterval(() => res.write(': ping\n\n'), 25000)
    res.write(': ok\n\n')
    req.on('close', () => {
      clearInterval(ping)
      events.off('jobs', onJobs)
      events.off('project-updated', onProject)
    })
    return
  }

  if (p === '/api/upload' && req.method === 'POST') {
    const name = path.basename(u.searchParams.get('name') ?? 'fichier').replace(/[^\w.\- ]+/g, '-').slice(-80) || 'fichier'
    const dir = path.join(UPLOADS(), crypto.randomBytes(6).toString('hex'))
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, name)
    try {
      await pipeline(req, fs.createWriteStream(file))
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true })
      return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
    }
    return json(res, 200, { ok: true, value: file })
  }

  if (p.startsWith('/media/')) {
    try {
      const file = resolveMediaFile(p.slice('/media/'.length).split('/').filter(Boolean).map(decodeURIComponent))
      if (!file) return res.writeHead(403).end('forbidden')
      return sendFile(req, res, file)
    } catch {
      return res.writeHead(404).end('not found')
    }
  }

  // Exports and their .srt, downloaded by the browser instead of « Afficher dans le Finder ».
  if (p === '/download') {
    const base = path.resolve(root())
    const file = path.resolve(u.searchParams.get('path') ?? '')
    if (!file.startsWith(base + path.sep)) return res.writeHead(403).end('forbidden')
    return sendFile(req, res, file, { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` })
  }

  // The editor itself (electron-vite build of the renderer). index.html is tagged so the page knows it is served.
  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(STATIC, 'index.html'), 'utf8').replace('<head>', '<head>\n    <meta name="rushcut-mode" content="server" />')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
    return res.end(html)
  }
  const file = path.resolve(STATIC, '.' + decodeURIComponent(p))
  if (!file.startsWith(STATIC + path.sep)) return res.writeHead(403).end('forbidden')
  return sendFile(req, res, file, { 'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
}

/** Starts the HTTP server; resolves with the URL the export's offscreen window loads the renderer from. */
export function startServer(): Promise<string> {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (!res.headersSent) json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      else res.end()
    })
  })
  server.requestTimeout = 0
  return new Promise((resolve) =>
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Rushcut (serveur) sur http://0.0.0.0:${PORT} — données : ${DATA_DIR}`)
      resolve(`http://127.0.0.1:${PORT}/`)
    })
  )
}
