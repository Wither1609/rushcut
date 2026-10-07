import { BrowserWindow } from 'electron'
import type { JobState } from '../shared/types'

// One heavy job at a time: a queue keeps the machine responsive while proxies or exports run.
const jobs = new Map<string, JobState & { projectId: string }>()
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
}

/** Queue a heavy job (ffmpeg). `light` jobs (network calls) run immediately, outside the queue. */
export function enqueue<T>(projectId: string, label: string, fn: (ctx: JobCtx) => Promise<T>, light = false): Promise<T> {
  const id = `job${++seq}`
  const job: JobState & { projectId: string } = { id, projectId, label, progress: -1, status: 'queued' }
  jobs.set(id, job)
  broadcast()
  const exec = async () => {
    job.status = 'running'
    broadcast()
    try {
      const r = await fn({
        progress: (p, l) => {
          job.progress = p
          if (l) job.label = l
          throttledBroadcast()
        }
      })
      job.status = 'done'
      job.progress = 1
      return r
    } catch (e) {
      job.status = 'error'
      job.error = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
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

export function dismissJob(id: string) {
  jobs.delete(id)
  broadcast()
}

export function notifyProject(projectId: string) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('project-updated', projectId)
}
