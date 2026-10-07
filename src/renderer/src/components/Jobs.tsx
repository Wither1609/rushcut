import { api } from '../api'
import type { JobState } from '../../../shared/types'

export function Jobs({ jobs }: { jobs: JobState[] }) {
  if (!jobs.length) return null
  return (
    <div className="jobs" aria-live="polite">
      {jobs.map((j) => (
        <div key={j.id} className={`job${j.status === 'error' ? ' error' : ''}`}>
          <div className="row">
            <b style={{ fontSize: 12 }}>{j.label}</b>
            <div className="spacer" />
            <span className="muted mono" style={{ fontSize: 11 }}>
              {j.status === 'queued' ? 'en attente' : j.status === 'done' ? 'terminé' : j.status === 'error' ? 'échec' : j.progress >= 0 ? `${Math.round(j.progress * 100)} %` : ''}
            </span>
            {j.status === 'error' && <button className="btn sm ghost" onClick={() => void api.dismissJob(j.id)}>Fermer</button>}
          </div>
          {j.status === 'error' ? (
            <div className="err">{j.error}</div>
          ) : (
            <div className={`bar${j.status === 'running' && j.progress < 0 ? ' indet' : ''}`}>
              <i style={{ width: `${Math.max(0, j.progress) * 100}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
