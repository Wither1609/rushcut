import { FFMPEG, probe, run, THREADS } from './ffmpeg'
import { analyzeReference } from './claude'
import type { Recipe } from '../shared/types'
import path from 'path'

/** Scene cuts with ffmpeg's scene score, then a handful of keyframes for Claude to look at. */
export async function recipeFromReference(file: string, onProgress: (p: number, label?: string) => void, signal: AbortSignal): Promise<Recipe> {
  const info = await probe(file)
  onProgress(0, 'Détection des coupes')
  // Analyse a small, low-fps copy of the stream: fast and plenty for shot boundaries.
  const { stderr } = await run(
    FFMPEG,
    ['-i', file, '-an', '-vf', "fps=10,scale=320:-2,select='gt(scene,0.32)',showinfo", '-threads', THREADS, '-f', 'null', '-'],
    { duration: info.duration, onProgress: (p) => onProgress(p * 0.6), signal }
  )
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.2)
  const bounds = [0, ...cuts, info.duration]
  const shots = bounds.slice(1).map((t, i) => t - bounds[i]).filter((d) => d > 0.05)

  // Up to 10 keyframes spread over the video, each in the middle of a shot.
  const mids = bounds.slice(1).map((t, i) => (t + bounds[i]) / 2)
  const step = Math.max(1, Math.ceil(mids.length / 10))
  const picks = mids.filter((_, i) => i % step === 0).slice(0, 10)
  const frames: { t: number; jpg: Buffer }[] = []
  for (const [i, t] of picks.entries()) {
    onProgress(0.6 + (0.25 * i) / picks.length, 'Images clés')
    const { stdout } = await run(FFMPEG, ['-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'], {
      collectStdout: true,
      signal
    })
    frames.push({ t, jpg: stdout })
  }
  onProgress(0.9, 'Claude analyse le style')
  return analyzeReference(path.basename(file), info.duration, shots, frames, signal)
}
