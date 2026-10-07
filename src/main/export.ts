import { BrowserWindow } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { detectEncoder, FFMPEG, run, runDecoding, videoEncoderArgs } from './ffmpeg'
import { loadBundle } from './projects'
import { getDesignSystem } from './store'
import { throwIfCancelled, type JobCtx } from './jobs'
import { editedDuration } from '../shared/edl'
import { buildChunks, chunksToOut, gfxToOut, sampleTimes } from '../shared/overlay'
import { buildSrt } from '../shared/srt'
import type { ExportOptions, Range } from '../shared/types'

const sha = (v: unknown) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 16)
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
const q = (p: string) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`

let rendererUrl = ''
export function setRendererUrl(u: string) {
  rendererUrl = u
}

interface Piece extends Range {
  scale: number
}

/** Split kept ranges at zoom boundaries so each piece has one constant framing. */
function pieces(keep: Range[], zooms: { t: number; d: number; scale: number }[]): Piece[] {
  const out: Piece[] = []
  for (const r of keep) {
    const cuts = new Set<number>([r.in, r.out])
    for (const z of zooms) {
      if (z.t > r.in && z.t < r.out) cuts.add(z.t)
      if (z.t + z.d > r.in && z.t + z.d < r.out) cuts.add(z.t + z.d)
    }
    const pts = [...cuts].sort((a, b) => a - b)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (b - a < 0.04) continue
      const mid = (a + b) / 2
      const z = zooms.find((z) => mid >= z.t && mid < z.t + z.d)
      out.push({ in: a, out: b, scale: z ? z.scale : 1 })
    }
  }
  return out
}

export async function exportVersion(projectId: string, opts: ExportOptions, ctx: JobCtx): Promise<string> {
  const b = loadBundle(projectId)
  const edl = b.edls[opts.version]
  if (!edl) throw new Error(`Version ${opts.version} introuvable`)
  const { media, dir } = { media: b.project.media, dir: b.project.dir }
  const ds = getDesignSystem(edl.designSystem)
  const vertical = opts.aspect === '9:16'
  // Vertical: 1080 means 1080×1920, whatever the rush. Landscape: never upscale the rush.
  const W = vertical ? even(opts.height) : even((Math.min(opts.height, media.height) * media.width) / media.height)
  const H = vertical ? even((W * 16) / 9) : even(Math.min(opts.height, media.height))
  // Cut the 9:16 frame out of the rush. Heads sit in the upper part of the frame, hence 0.4 when cropping height.
  const cropX = Math.min(1, Math.max(0, opts.cropX ?? 0.5))
  const reframe = vertical ? `crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-ow)*${cropX.toFixed(3)}':y='(ih-oh)*0.4',` : ''
  const FPS = Math.min(60, Math.max(24, Math.round(media.fps) || 30))
  const total = editedDuration(edl.keep)
  const cache = path.join(dir, 'cache')
  fs.mkdirSync(cache, { recursive: true })
  const stat = fs.statSync(media.path)

  // 1. Video pieces. Each one is cached by content: a V2 that changes 2 cuts re-encodes only those.
  const list = pieces(edl.keep, edl.zooms)
  const pieceEnc = await videoEncoderArgs(H >= 2160 ? 60000 : H >= 1080 ? 25000 : 12000, 14)
  const files = list.map((p) => path.join(cache, `p_${sha({ src: media.path, size: stat.size, mtime: stat.mtimeMs, p, W, H, FPS, pieceEnc, reframe })}.mkv`))
  const todo = list.map((p, i) => ({ p, file: files[i] })).filter(({ file }) => !fs.existsSync(file))
  const reused = list.length - todo.length
  const encodePiece = async (p: Piece, file: string) => {
    const len = p.out - p.in
    const s = p.scale
    const vf =
      reframe +
      (s > 1.001 ? `crop=iw/${s}:ih/${s}:(iw-iw/${s})/2:(ih-ih/${s})*0.4,` : '') + `scale=${W}:${H}:flags=lanczos,setsar=1,fps=${FPS},format=yuv420p`
    const fade = Math.min(0.012, len / 4)
    const af = `aresample=48000,afade=t=in:d=${fade},afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade}`
    const audioIn = media.hasAudio ? [] : ['-f', 'lavfi', '-t', len.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo']
    const tmp = file + '.part.mkv'
    try {
      await runDecoding(
        [
          '-ss', p.in.toFixed(3), '-t', len.toFixed(3), '-i', media.path, ...audioIn,
          '-map', '0:v:0', '-map', media.hasAudio ? '0:a:0' : '1:a:0',
          '-vf', vf, '-af', af, ...pieceEnc, '-c:a', 'pcm_s16le', '-ac', '2', '-t', len.toFixed(3), tmp
        ],
        { signal: ctx.signal }
      )
      fs.renameSync(tmp, file)
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  }
  // Hardware encoders run several sessions side by side; libx264 already uses half the cores on its own.
  const workers = (await detectEncoder()) === 'libx264' ? 1 : 3
  let next = 0
  let done = 0
  const errors: unknown[] = []
  const worker = async () => {
    while (!errors.length && next < todo.length) {
      const { p, file } = todo[next++]
      try {
        await encodePiece(p, file)
      } catch (error) {
        errors.push(error)
      }
      ctx.progress((++done / todo.length) * 0.5, `Segments ${done}/${todo.length}`)
    }
  }
  if (todo.length) ctx.progress(0, `Segments 0/${todo.length}`)
  await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, worker))
  if (errors.length) throw errors[0]
  const piecesTxt = path.join(cache, `pieces_${opts.version}.txt`)
  fs.writeFileSync(piecesTxt, files.map(q).join('\n'))

  // 2. Overlay: motion design + captions rendered by Chromium, only at the instants where it changes.
  const gfxOut = gfxToOut(edl.gfx, edl.keep)
  const chunks = edl.captions.enabled && opts.burnCaptions ? chunksToOut(buildChunks(b.words, edl.keep, edl.captions.maxWords), edl.keep) : []
  let overlayTxt: string | null = null
  if (gfxOut.length || chunks.length) {
    const payload = { gfx: gfxOut, chunks, ds, W, H, uppercase: edl.captions.uppercase, projectId: b.project.id, captionStyle: edl.captions.style }
    const odir = path.join(cache, `overlay_${sha({ payload, FPS, v: 2 })}`)
    overlayTxt = path.join(odir, 'list.txt')
    if (!fs.existsSync(overlayTxt)) {
      const times = sampleTimes(gfxOut, chunks, total, FPS)
      fs.mkdirSync(odir, { recursive: true })
      await renderOverlay(payload, times, odir, (p) => ctx.progress(0.5 + p * 0.25, `Motion design ${Math.round(p * times.length)}/${times.length} images`), ctx.signal)
      const lines: string[] = []
      times.forEach((t, i) => {
        const next = i + 1 < times.length ? times[i + 1] : total
        lines.push(q(path.join(odir, `f${i}.png`)), `duration ${(next - t).toFixed(4)}`)
      })
      lines.push(q(path.join(odir, `f${times.length - 1}.png`)))
      fs.writeFileSync(overlayTxt + '.tmp', lines.join('\n'))
      fs.renameSync(overlayTxt + '.tmp', overlayTxt)
    }
  }

  // 3. Final pass: concat without re-decoding the raw, overlay, encode once.
  const outDir = path.join(dir, 'exports')
  fs.mkdirSync(outDir, { recursive: true })
  const out = path.join(outDir, `${b.project.name.replace(/[^\w-]+/g, '-')}-${opts.version}-${vertical ? `${W}x${H}` : `${H}p`}.mp4`)
  if (opts.srt) fs.writeFileSync(out.replace(/\.mp4$/, '.srt'), buildSrt(b.words, edl.keep))
  const finalEnc = await videoEncoderArgs(H >= 2160 ? 40000 : H >= 1080 ? 12000 : 6000, 19, 'fast')
  const args = ['-f', 'concat', '-safe', '0', '-i', piecesTxt]
  if (overlayTxt) {
    args.push('-f', 'concat', '-safe', '0', '-i', overlayTxt)
    args.push('-filter_complex', `[1:v]fps=${FPS},format=rgba[ov];[0:v][ov]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v]`, '-map', '[v]')
  } else args.push('-map', '0:v')
  args.push('-map', '0:a', ...finalEnc, '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out)
  ctx.progress(0.75, reused ? `Assemblage (${reused}/${list.length} segments en cache)` : 'Assemblage')
  try {
    await run(FFMPEG, args, { duration: total, onProgress: (p) => ctx.progress(0.75 + p * 0.25), signal: ctx.signal })
  } catch (e) {
    // A half-written MP4 next to the good ones would be mistaken for a finished export.
    fs.rmSync(out, { force: true })
    if (opts.srt) fs.rmSync(out.replace(/\.mp4$/, '.srt'), { force: true })
    throw e
  }
  return out
}

async function renderOverlay(payload: unknown, times: number[], odir: string, onProgress: (p: number) => void, signal: AbortSignal) {
  const { W, H } = payload as { W: number; H: number }
  const win = new BrowserWindow({
    show: false,
    width: W,
    height: H,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  try {
    win.setContentSize(W, H)
    await win.loadURL(rendererUrl + '#render')
    await win.webContents.executeJavaScript(`window.__rcSetup(${JSON.stringify(payload)})`)
    for (const [i, t] of times.entries()) {
      throwIfCancelled(signal)
      await win.webContents.executeJavaScript(`window.__rcSeek(${t})`)
      let img = await win.webContents.capturePage()
      const s = img.getSize()
      if (s.width !== W || s.height !== H) img = img.resize({ width: W, height: H, quality: 'best' })
      fs.writeFileSync(path.join(odir, `f${i}.png`), img.toPNG())
      if (i % 5 === 0) onProgress(i / times.length)
    }
  } finally {
    win.destroy()
  }
}
