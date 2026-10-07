import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { Home } from './Home'
import { Editor } from './Editor'
import { SettingsModal } from './components/SettingsModal'
import { Jobs } from './components/Jobs'
import type { JobState, PublicSettings } from '../../shared/types'

export const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true">
    <rect x="2" y="6" width="24" height="16" rx="3" fill="none" stroke="#ff7a1a" strokeWidth="2" />
    <path d="M10 6v16M18 6v16" stroke="#ff7a1a" strokeWidth="2" />
    <circle cx="14" cy="14" r="2.5" fill="#ff7a1a" />
  </svg>
)

let toastTimer: ReturnType<typeof setTimeout> | undefined
export type Notify = (msg: string, err?: boolean) => void

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [jobs, setJobs] = useState<JobState[]>([])
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null)

  const notify: Notify = useCallback((msg, err = false) => {
    setToast({ msg, err })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(null), err ? 7000 : 3500)
  }, [])

  useEffect(() => {
    void api.settings().then((s) => {
      setSettings(s)
      if (!s.hasAnthropicKey || !s.hasElevenKey) setSettingsOpen(true)
    })
    void api.jobs().then(setJobs)
    return window.rushcut.on('jobs', (j) => setJobs(j as JobState[]))
  }, [])

  return (
    <>
      {projectId ? (
        <Editor projectId={projectId} onClose={() => setProjectId(null)} openSettings={() => setSettingsOpen(true)} notify={notify} jobs={jobs} />
      ) : (
        <Home onOpen={setProjectId} openSettings={() => setSettingsOpen(true)} notify={notify} settings={settings} />
      )}
      {settingsOpen && settings && <SettingsModal settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} notify={notify} />}
      <Jobs jobs={jobs} />
      {toast && <div className={`toast${toast.err ? ' err' : ''}`} role="status">{toast.msg}</div>}
    </>
  )
}
