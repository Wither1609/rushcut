import path from 'path'
import { loadProject, projectDir } from './projects'

/** IPC handlers by channel, also called by the HTTP server in server mode. */
export const handlers = new Map<string, (...args: unknown[]) => unknown>()

export const MIME: Record<string, string> = { '.webp': 'image/webp', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json', '.srt': 'application/x-subrip' }

/** [projectId, ...file] → absolute path inside the project, or null. `__source` is the raw file itself (used until the proxy is ready). */
export function resolveMediaFile(parts: string[]): string | null {
  const base = path.resolve(projectDir(parts[0]))
  if (parts[1] === '__source') return loadProject(parts[0]).media.path
  const file = path.resolve(base, ...parts.slice(1))
  return file.startsWith(base + path.sep) ? file : null
}
