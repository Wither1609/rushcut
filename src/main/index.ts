import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { Readable } from 'stream'
import {
  addIllustrations, createProject, deleteProject, removeIllustration, listProjects, loadBundle, loadProject, nextVersionName, projectDir, root, runImportPipeline, saveComments,
  saveCommentFrame, saveEdl, transcribeProject, updateProject
} from './projects'
import { deleteDesignSystem, getSettings, listDesignSystems, publicSettings, saveDesignSystem, setSettings } from './store'
import { dismissJob, enqueue, listJobs, notifyProject } from './jobs'
import { applyComments, designSystemFromImage, generateFirstCut } from './claude'
import { recipeFromReference } from './reference'
import { exportVersion, setRendererUrl } from './export'
import type { Comment, DesignSystem, Edl, ExportOptions, Project, Settings } from '../shared/types'

protocol.registerSchemesAsPrivileged([
  { scheme: 'rushcut', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])

const MIME: Record<string, string> = { '.webp': 'image/webp', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json' }

/** rushcut://p/<projectId>/<file> serves project files, with byte ranges so the video can seek. */
function registerProtocol() {
  protocol.handle('rushcut', async (req) => {
    try {
      const u = new URL(req.url)
      const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const base = projectDir(parts[0])
      // __source is the raw file itself (used until the proxy is ready).
      const file = parts[1] === '__source' ? loadProject(parts[0]).media.path : path.resolve(base, ...parts.slice(1))
      if (parts[1] !== '__source' && !file.startsWith(path.resolve(base) + path.sep)) return new Response('forbidden', { status: 403 })
      const size = fs.statSync(file).size
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
      const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/)
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream
        return new Response(body, {
          status: 206,
          headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
        })
      }
      const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream
      return new Response(body, { headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size), 'Cache-Control': 'no-cache' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function rendererUrl() {
  return process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#110f0d',
    title: 'Rushcut',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js') }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadURL(rendererUrl())
}

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'mxf']

async function pickFile(title: string, extensions: string[]): Promise<string | null> {
  const r = await dialog.showOpenDialog({ title, properties: ['openFile'], filters: [{ name: title, extensions }] })
  return r.canceled ? null : r.filePaths[0]
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

function registerIpc() {
  handle('settings:get', () => publicSettings())
  handle('settings:set', (patch: Partial<Settings>) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    return setSettings(clean)
  })
  handle('settings:pickDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath: getSettings().projectsDir })
    return r.canceled ? null : setSettings({ projectsDir: r.filePaths[0] })
  })

  handle('ds:list', () => listDesignSystems())
  handle('ds:save', (ds: DesignSystem) => saveDesignSystem(ds))
  handle('ds:delete', (id: string) => deleteDesignSystem(id))
  handle('ds:fromImage', async () => {
    const f = await pickFile('Capture, deck ou site', ['png', 'jpg', 'jpeg', 'webp'])
    if (!f) return null
    const ds = await enqueue('global', 'Claude lit le design system', () => designSystemFromImage(f), true)
    saveDesignSystem(ds)
    return ds
  })

  handle('projects:list', () => listProjects())
  handle('projects:create', async (file?: string) => {
    const f = file ?? (await pickFile('Rush vidéo', VIDEO_EXT))
    return f ? createProject(f) : null
  })
  handle('projects:delete', (id: string) => deleteProject(id))
  handle('projects:reveal', (id: string) => shell.openPath(projectDir(id)))
  handle('project:bundle', (id: string) => loadBundle(id))
  handle('project:update', (id: string, patch: Partial<Project>) => updateProject(id, patch))
  handle('project:saveEdl', (id: string, edl: Edl) => saveEdl(id, edl))
  handle('project:saveComments', (id: string, c: Comment[]) => saveComments(id, c))
  handle('project:saveFrame', (id: string, cid: string, dataUrl: string) => saveCommentFrame(id, cid, dataUrl))
  handle('assets:add', async (id: string, files?: string[]) => {
    let list = files
    if (!list) {
      const r = await dialog.showOpenDialog({ title: 'Images d’illustration', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
      if (r.canceled) return null
      list = r.filePaths
    }
    const out = addIllustrations(id, list)
    notifyProject(id)
    return out
  })
  handle('assets:remove', (id: string, file: string) => {
    const out = removeIllustration(id, file)
    notifyProject(id)
    return out
  })
  handle('project:transcribe', (id: string) => transcribeProject(id))
  handle('project:resumeImport', (id: string) => runImportPipeline(id))

  handle('ai:generate', async (id: string, base: string | null, dsId: string) => {
    const b = loadBundle(id)
    const version = nextVersionName(b.project)
    const baseEdl = base ? b.edls[base] : null
    const open = b.comments.filter((c) => !c.fixedIn)
    const firstCut = !baseEdl || baseEdl.version === 'V0'
    if (!firstCut && !open.length) throw new Error('Aucun commentaire ouvert : pose des pins ou des dessins avant de générer une nouvelle version.')
    const edl = await enqueue(
      id,
      firstCut ? `Claude monte la ${version}` : `Claude applique ${open.length} commentaire${open.length > 1 ? 's' : ''} → ${version}`,
      () => (firstCut ? generateFirstCut(b, version, dsId) : applyComments(b, baseEdl!, open, version, dsId)),
      true
    )
    if (baseEdl && baseEdl.status === 'review') saveEdl(id, { ...baseEdl, status: 'archived' })
    saveEdl(id, edl)
    if (edl.resolves.length) saveComments(id, b.comments.map((c) => (edl.resolves.includes(c.id) ? { ...c, fixedIn: version } : c)))
    updateProject(id, { current: version, designSystem: dsId })
    notifyProject(id)
    return version
  })

  handle('ai:reference', async (id: string) => {
    const f = await pickFile('Vidéo d’exemple', VIDEO_EXT)
    if (!f) return null
    const recipe = await enqueue(id, 'Analyse de la vidéo d’exemple', (ctx) => recipeFromReference(f, ctx.progress))
    updateProject(id, { recipe })
    notifyProject(id)
    return recipe
  })

  handle('export:start', (id: string, opts: ExportOptions) => enqueue(id, `Export ${opts.version} ${opts.aspect === '9:16' ? `vertical ${opts.height}×${Math.round((opts.height * 16) / 9)}` : `${opts.height}p`}`, (ctx) => exportVersion(id, opts, ctx)))
  handle('shell:reveal', (p: string) => shell.showItemInFolder(p))
  handle('shell:open', (url: string) => (/^https:\/\//.test(url) ? shell.openExternal(url) : undefined))
  handle('jobs:list', () => listJobs())
  handle('jobs:dismiss', (jobId: string) => dismissJob(jobId))
  handle('app:info', () => ({ root: root(), platform: process.platform, version: app.getVersion() }))
}

app.whenReady().then(() => {
  registerProtocol()
  registerIpc()
  setRendererUrl(rendererUrl())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
