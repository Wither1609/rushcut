import type { RushcutApi } from '../../preload/index'

// Server mode (Rushcut behind Work OS, opened in a browser): no preload, so window.rushcut is built here.
// Calls go to POST api/call/<channel>, events come from api/events, and the file dialogs of the desktop app
// become a browser file picker followed by an upload. Every URL is relative: the editor is served under /wither/.

/** Page served by the Rushcut server (it tags index.html), as opposed to the desktop window or its export renderer. */
export const SERVED = typeof document !== 'undefined' && !!document.querySelector('meta[name="rushcut-mode"][content="server"]')
export const WEB = SERVED && !window.rushcut

const VIDEO = 'video/*,.mkv,.mts,.mxf'
const IMAGE = 'image/png,image/jpeg,image/webp,image/gif'

function pick(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

/** Upload banner: a rush can weigh several GB. */
function banner() {
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.style.zIndex = '10000'
  document.body.appendChild(el)
  return { set: (t: string) => (el.textContent = t), done: () => el.remove() }
}

function upload(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const b = banner()
    b.set(`Envoi de ${f.name}…`)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `api/upload?name=${encodeURIComponent(f.name)}`)
    xhr.upload.onprogress = (e) => e.lengthComputable && b.set(`Envoi de ${f.name} : ${Math.round((e.loaded / e.total) * 100)} %`)
    xhr.onload = () => {
      b.done()
      try {
        const r = JSON.parse(xhr.responseText) as { ok: boolean; value?: string; error?: string }
        if (r.ok && r.value) resolve(r.value)
        else reject(new Error(r.error ?? `Envoi impossible (HTTP ${xhr.status})`))
      } catch {
        reject(new Error(`Envoi impossible (HTTP ${xhr.status})`))
      }
    }
    xhr.onerror = () => {
      b.done()
      reject(new Error('Envoi interrompu'))
    }
    xhr.send(f)
  })
}

async function pickAndUpload(accept: string, multiple = false): Promise<string[] | null> {
  const files = await pick(accept, multiple)
  if (!files.length) return null
  const out: string[] = []
  for (const f of files) out.push(await upload(f))
  return out
}

async function post<T>(channel: string, args: unknown[]): Promise<T> {
  const res = await fetch(`api/call/${encodeURIComponent(channel)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  // Session expired: Work OS answers with its login page.
  if (!res.headers.get('content-type')?.includes('application/json')) {
    location.reload()
    throw new Error('Session expirée')
  }
  const r = (await res.json()) as { ok: true; value: T } | { ok: false; error: string }
  if (!r.ok) throw new Error(r.error)
  return r.value
}

/** The desktop app's file dialogs and Finder actions, done the browser way. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  switch (channel) {
    case 'projects:create': {
      if (args[0]) break
      const f = await pickAndUpload(VIDEO)
      if (!f) return null as T
      return post<T>(channel, [f[0]])
    }
    case 'assets:add': {
      if (args[1]) break
      const f = await pickAndUpload(IMAGE, true)
      if (!f) return null as T
      return post<T>(channel, [args[0], f])
    }
    case 'ds:fromImage': {
      const f = await pickAndUpload(IMAGE)
      if (!f) return null as T
      return post<T>(channel, [f[0]])
    }
    case 'ai:reference': {
      const f = await pickAndUpload(VIDEO)
      if (!f) return null as T
      return post<T>(channel, [args[0], f[0]])
    }
    case 'settings:pickDir':
      throw new Error('Le dossier des projets est fixé sur le serveur.')
    case 'projects:reveal':
      return undefined as T
    case 'shell:reveal': {
      // An export: download it.
      const a = document.createElement('a')
      a.href = `download?path=${encodeURIComponent(String(args[0]))}`
      a.download = ''
      document.body.appendChild(a)
      a.click()
      a.remove()
      return undefined as T
    }
    case 'shell:open':
      window.open(String(args[0]), '_blank', 'noopener')
      return undefined as T
  }
  return post<T>(channel, args)
}

type Listener = (payload: unknown) => void
const listeners: Record<'jobs' | 'project-updated', Set<Listener>> = { jobs: new Set(), 'project-updated': new Set() }
let source: EventSource | null = null

function connect() {
  if (source) return
  source = new EventSource('api/events')
  for (const ch of ['jobs', 'project-updated'] as const) {
    source.addEventListener(ch, (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as unknown
      for (const fn of listeners[ch]) fn(data)
    })
  }
}

const webApi: RushcutApi = {
  call,
  on(channel, cb) {
    connect()
    listeners[channel].add(cb)
    return () => {
      listeners[channel].delete(cb)
    }
  },
  fileRef: upload,
  platform: 'web' as NodeJS.Platform
}

if (WEB) {
  window.rushcut = webApi
  // Opened from Work OS: a way back.
  const back = new URLSearchParams(location.search).get('retour')
  try {
    // Same domain as Work OS only: never a link to an arbitrary site.
    if (back && new URL(back, location.href).host === location.host) sessionStorage.setItem('rc-retour', back)
  } catch {
    /* storage blocked */
  }
}

export function returnUrl(): string | null {
  try {
    return sessionStorage.getItem('rc-retour')
  } catch {
    return null
  }
}
