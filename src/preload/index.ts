import { contextBridge, ipcRenderer, webUtils } from 'electron'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const api = {
  call,
  on(channel: 'jobs' | 'project-updated', cb: (payload: unknown) => void) {
    const fn = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, fn)
    return () => {
      ipcRenderer.removeListener(channel, fn)
    }
  },
  /** Path of a file dropped on the window, as the main process can read it (uploaded first in server mode). */
  fileRef: async (f: File) => webUtils.getPathForFile(f),
  platform: process.platform
}

contextBridge.exposeInMainWorld('rushcut', api)
export type RushcutApi = typeof api
