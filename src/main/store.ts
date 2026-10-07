import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import { BUILTIN_DS, type DesignSystem, type PublicSettings, type Settings } from '../shared/types'

const file = () => path.join(app.getPath('userData'), 'settings.json')
const dsFile = () => path.join(app.getPath('userData'), 'design-systems.json')

const defaults = (): Settings => ({
  anthropicKey: '',
  elevenKey: '',
  claudeModel: 'claude-opus-5-5',
  effort: 'high',
  scribeModel: 'scribe_v2',
  projectsDir: path.join(app.getPath('documents'), 'Rushcut')
})

// API keys are encrypted with the OS keychain (Keychain on Mac, DPAPI on Windows) when available.
function seal(v: string): string {
  if (!v) return ''
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(v).toString('base64')
  return 'raw:' + Buffer.from(v).toString('base64')
}
function unseal(v: string): string {
  if (!v) return ''
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
    if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString()
  } catch {
    /* keychain changed: key must be re-entered */
  }
  return ''
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const s = defaults()
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'))
    Object.assign(s, j, { anthropicKey: unseal(j.anthropicKey), elevenKey: unseal(j.elevenKey) })
  } catch {
    /* first run */
  }
  // Environment variables work too, handy in development.
  if (!s.anthropicKey && process.env.ANTHROPIC_API_KEY) s.anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!s.elevenKey && process.env.ELEVENLABS_API_KEY) s.elevenKey = process.env.ELEVENLABS_API_KEY
  cache = s
  return s
}

export function setSettings(patch: Partial<Settings>): PublicSettings {
  const s = { ...getSettings(), ...patch }
  cache = s
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify({ ...s, anthropicKey: seal(s.anthropicKey), elevenKey: seal(s.elevenKey) }, null, 2))
  return publicSettings()
}

export function publicSettings(): PublicSettings {
  const s = getSettings()
  return {
    hasAnthropicKey: !!s.anthropicKey,
    hasElevenKey: !!s.elevenKey,
    claudeModel: s.claudeModel,
    effort: s.effort,
    scribeModel: s.scribeModel,
    projectsDir: s.projectsDir
  }
}

export function listDesignSystems(): DesignSystem[] {
  let custom: DesignSystem[] = []
  try {
    custom = JSON.parse(fs.readFileSync(dsFile(), 'utf8'))
  } catch {
    /* none yet */
  }
  return [...BUILTIN_DS, ...custom]
}

export function saveDesignSystem(ds: DesignSystem): DesignSystem[] {
  const custom = listDesignSystems().filter((d) => !d.builtin && d.id !== ds.id)
  custom.push({ ...ds, builtin: false })
  fs.mkdirSync(path.dirname(dsFile()), { recursive: true })
  fs.writeFileSync(dsFile(), JSON.stringify(custom, null, 2))
  return listDesignSystems()
}

export function deleteDesignSystem(id: string): DesignSystem[] {
  const custom = listDesignSystems().filter((d) => !d.builtin && d.id !== id)
  fs.writeFileSync(dsFile(), JSON.stringify(custom, null, 2))
  return listDesignSystems()
}

export function getDesignSystem(id: string): DesignSystem {
  return listDesignSystems().find((d) => d.id === id) ?? BUILTIN_DS[0]
}
