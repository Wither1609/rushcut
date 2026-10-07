import { spawn } from 'child_process'
import os from 'os'
import fs from 'fs'
import ffmpegStatic from 'ffmpeg-static'
// ffprobe-static has no types and is CJS: { path }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic: { path: string } = require('ffprobe-static')
import type { MediaInfo } from '../shared/types'

// In a packaged app the binaries live in app.asar.unpacked (see asarUnpack in electron-builder.yml).
const unpack = (p: string) => p.replace('app.asar', 'app.asar.unpacked')
export const FFMPEG = unpack(ffmpegStatic as unknown as string)
export const FFPROBE = unpack(ffprobeStatic.path)

/** Leave half the cores to the rest of the machine. */
export const THREADS = String(Math.max(2, Math.floor(os.cpus().length / 2)))

export interface RunOptions {
  /** Total duration in seconds, enables progress reporting through -progress pipe:1. */
  duration?: number
  onProgress?: (p: number) => void
  /** Collect stdout as a Buffer (disables progress parsing). */
  collectStdout?: boolean
  onStdout?: (chunk: Buffer) => void
  signal?: AbortSignal
}

export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const withProgress = bin === FFMPEG && opts.duration && !opts.collectStdout && !opts.onStdout
    const fullArgs = bin === FFMPEG ? ['-hide_banner', '-y', ...(withProgress ? ['-progress', 'pipe:1', '-nostats'] : []), ...args] : args
    const child = spawn(bin, fullArgs, { windowsHide: true })
    try {
      // Background work must never make the editor stutter.
      os.setPriority(child.pid!, os.constants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      /* not permitted on some systems */
    }
    const out: Buffer[] = []
    let err = ''
    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      if (opts.onStdout) return opts.onStdout(d)
      if (opts.collectStdout) return void out.push(d)
      if (withProgress) {
        buf += d.toString()
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const l of lines) {
          if (l.startsWith('out_time_us=') || l.startsWith('out_time_ms=')) {
            const us = Number(l.split('=')[1])
            if (Number.isFinite(us)) opts.onProgress?.(Math.min(1, us / 1e6 / opts.duration!))
          }
        }
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString()
      if (err.length > 200_000) err = err.slice(-100_000)
    })
    const abort = () => child.kill('SIGKILL')
    opts.signal?.addEventListener('abort', abort)
    child.on('error', reject)
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', abort)
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err })
      else reject(new Error(`${bin.split(/[\\/]/).pop()} a échoué (code ${code}) :\n${err.split('\n').slice(-8).join('\n')}`))
    })
  })
}

export async function probe(file: string): Promise<MediaInfo> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    collectStdout: true
  })
  const j = JSON.parse(stdout.toString())
  const v = (j.streams || []).find((s: { codec_type: string }) => s.codec_type === 'video')
  const a = (j.streams || []).find((s: { codec_type: string }) => s.codec_type === 'audio')
  if (!v) throw new Error('Aucune piste vidéo dans ce fichier.')
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number)
  let width = v.width
  let height = v.height
  const rot = Number(v.tags?.rotate ?? v.side_data_list?.find((s: { rotation?: number }) => s.rotation !== undefined)?.rotation ?? 0)
  if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [width, height] = [height, width]
  return {
    path: file,
    duration: Number(j.format.duration || v.duration || 0),
    width,
    height,
    fps: d ? n / d : 30,
    hasAudio: !!a
  }
}

// ---------------------------------------------------------------------------
// Hardware encoder detection: VideoToolbox on Mac, NVENC / QuickSync / AMF on Windows.

type EncoderId = 'h264_videotoolbox' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264'
let encoderCache: EncoderId | null = null

export async function detectEncoder(): Promise<EncoderId> {
  if (encoderCache) return encoderCache
  const candidates: EncoderId[] =
    process.platform === 'darwin' ? ['h264_videotoolbox'] : process.platform === 'win32' ? ['h264_nvenc', 'h264_qsv', 'h264_amf'] : []
  for (const enc of candidates) {
    try {
      await run(FFMPEG, ['-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2', '-c:v', enc, '-f', 'null', '-'])
      encoderCache = enc
      return enc
    } catch {
      /* try the next one */
    }
  }
  encoderCache = 'libx264'
  return encoderCache
}

/** Encoder args for a target quality. `kbps` is used by hardware encoders, `crf` by libx264. */
export async function videoEncoderArgs(kbps: number, crf: number, preset = 'veryfast'): Promise<string[]> {
  const enc = await detectEncoder()
  const br = [`-b:v`, `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`]
  switch (enc) {
    case 'h264_videotoolbox':
      return ['-c:v', enc, '-allow_sw', '1', ...br]
    case 'h264_nvenc':
      return ['-c:v', enc, '-preset', 'p4', ...br]
    case 'h264_qsv':
    case 'h264_amf':
      return ['-c:v', enc, ...br]
    default:
      return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-threads', THREADS]
  }
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).size > 0
  } catch {
    return false
  }
}
