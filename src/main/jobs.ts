import { BrowserWindow } from 'electron'
import { CANCELLED, type JobState } from '../shared/types'

// One heavy job at a time: a queue keeps the machine responsive while proxies or exports run.
const jobs = new Map<string, JobState & { projectId: string }>()
const controllers = new Map<string, AbortController>()
let chain: Promise<unknown> = Promise.resolve()
let seq = 0

function broadcast() {
  const list = [...jobs.values()]
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('jobs', list)
}

let lastSent = 0
function throttledBroadcast() {
  const now = Date.now()
  if (now - lastSent > 150) {
    lastSent = now
    broadcast()
  }
}

export interface JobCtx {
  progress: (p: number, label?: string) => void
  /** Aborted when the user cancels the job: pass it to ffmpeg, fetch and Claude. */
  signal: AbortSignal
}

/** Throws the cancellation error if the job was cancelled, for loops between two awaits. */
export function throwIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error(CANCELLED)
}

/** Queue a heavy job (ffmpeg). `light` jobs (network calls) run immediately, outside the queue. */
export function enqueue<T>(projectId: string, label: string, fn: (ctx: JobCtx) => Promise<T>, light = false): Promise<T> {
  const id = `job${++seq}`
  const job: JobState & { projectId: string } = { id, projectId, label, progress: -1, status: 'queued' }
  const ctrl = new AbortController()
  jobs.set(id, job)
  controllers.set(id, ctrl)
  broadcast()
  const exec = async () => {
    try {
      // Cancelled while waiting in the queue: never starts.
      throwIfCancelled(ctrl.signal)
      job.status = 'running'
      broadcast()
      const r = await fn({
        progress: (p, l) => {
          job.progress = p
          if (l) job.label = l
          throttledBroadcast()
        },
        signal: ctrl.signal
      })
      throwIfCancelled(ctrl.signal)
      job.status = 'done'
      job.progress = 1
      return r
    } catch (e) {
      // Whatever a cancelled job threw (ffmpeg killed, fetch aborted…), the caller sees one clear reason.
      if (ctrl.signal.aborted) throw new Error(CANCELLED)
      job.status = 'error'
      job.error = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      controllers.delete(id)
      broadcast()
      // Finished jobs disappear from the list after a while.
      setTimeout(() => {
        if (job.status === 'done') {
          jobs.delete(id)
          broadcast()
        }
      }, 4000)
    }
  }
  if (light) return exec()
  const p = chain.then(exec, exec)
  chain = p.catch(() => undefined)
  return p
}

export function listJobs(): JobState[] {
  return [...jobs.values()]
}

/** Stops a running job, or drops a queued one. It leaves the list at once. */
export function cancelJob(id: string) {
  controllers.get(id)?.abort()
  jobs.delete(id)
  broadcast()
}

export function dismissJob(id: string) {
  jobs.delete(id)
  broadcast()
}

export function notifyProject(projectId: string) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('project-updated', projectId)
}
