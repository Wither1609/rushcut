import { spawn, execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { getSettings } from './store'
import type { ClaudeCodeStatus } from '../shared/types'

// Subscription mode: Rushcut drives the Claude Code CLI installed on this computer (`claude -p`),
// which is signed in with the user's Claude Pro or Max plan. No API key is involved.

const isWin = process.platform === 'win32'
const exe = isWin ? 'claude.exe' : 'claude'

/** Places the official installers and npm put the CLI. Apps opened from the Finder do not get the shell PATH. */
function candidates(): string[] {
  const home = os.homedir()
  if (isWin) {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    return [
      path.join(home, '.local', 'bin', exe),
      path.join(local, 'Programs', 'claude', exe),
      // npm's claude.cmd needs a shell; the package ships the native binary next to it.
      path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', exe)
    ]
  }
  return [
    path.join(home, '.local', 'bin', exe),
    path.join(home, '.claude', 'local', exe),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    path.join(home, '.npm-global', 'bin', exe),
    path.join(home, '.bun', 'bin', exe)
  ]
}

function run(file: string, args: string[], timeout = 15000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/** Asks the user's login shell, which knows PATH entries added by nvm, volta, asdf… */
async function fromShell(): Promise<string | null> {
  if (isWin) {
    const r = await run('where.exe', [exe])
    return r.code === 0 ? (r.stdout.split(/\r?\n/).find((l) => l.trim().endsWith('.exe'))?.trim() ?? null) : null
  }
  const r = await run(process.env.SHELL || '/bin/zsh', ['-ilc', 'command -v claude'])
  const p = r.stdout.trim().split('\n').pop()?.trim()
  return r.code === 0 && p && path.isAbsolute(p) ? p : null
}

let found: string | null = null

export async function findClaude(): Promise<string | null> {
  const custom = getSettings().claudePath.trim()
  if (custom) return fs.existsSync(custom) ? custom : null
  if (found && fs.existsSync(found)) return found
  found = candidates().find((p) => fs.existsSync(p)) ?? (await fromShell())
  return found
}

/** Environment for the CLI: an API key in the environment would take precedence over the subscription. */
function cliEnv(bin: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  env.PATH = [path.dirname(bin), env.PATH].filter(Boolean).join(path.delimiter)
  return env
}

export async function claudeCodeStatus(): Promise<ClaudeCodeStatus> {
  found = null
  const bin = await findClaude()
  if (!bin) return { installed: false, loggedIn: false }
  const [v, s] = await Promise.all([run(bin, ['--version']), run(bin, ['auth', 'status', '--json'])])
  let auth: Record<string, unknown> = {}
  try {
    auth = JSON.parse(s.stdout)
  } catch {
    /* older CLI: unknown status */
  }
  return {
    installed: true,
    path: bin,
    version: v.stdout.trim().split(' ')[0] || undefined,
    loggedIn: auth.loggedIn === true,
    authMethod: typeof auth.authMethod === 'string' ? auth.authMethod : undefined,
    email: typeof auth.email === 'string' ? auth.email : undefined,
    plan: typeof auth.subscriptionType === 'string' ? auth.subscriptionType : undefined
  }
}

interface CliResult {
  type: 'result'
  subtype: string
  is_error: boolean
  result?: string
  structured_output?: unknown
  api_error_status?: number | null
}

/** A long V1 at high effort takes a few minutes; past this, the CLI is stuck (network, permission prompt…). */
const CLI_TIMEOUT_MS = 20 * 60_000

/** One request through `claude -p`: same system prompt, content blocks (images included) and JSON schema as the API path. */
export async function callClaudeCode(
  label: string,
  system: string,
  content: BetaContentBlockParam[],
  schema: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const bin = await findClaude()
  if (!bin) throw new Error('Claude Code est introuvable. Installe-le, connecte-toi avec ton abonnement (claude auth login), puis réessaie. Le chemin peut être indiqué dans Réglages.')
  const s = getSettings()
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', s.claudeModel,
    '--effort', s.effort,
    '--system-prompt', system,
    '--json-schema', JSON.stringify(schema),
    // A pure text task: no tools, no MCP servers, no skills, nothing written to the session history.
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence'
  ]
  // cache_control is an API-only hint; the CLI manages caching itself.
  const blocks = content.map((b) => {
    const { cache_control: _, ...rest } = b as BetaContentBlockParam & { cache_control?: unknown }
    return rest
  })
  const input = JSON.stringify({ type: 'user', message: { role: 'user', content: blocks } }) + '\n'

  const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    // Empty working directory, so no project CLAUDE.md is picked up.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rushcut-claude-'))
    const child = spawn(bin, args, { cwd, env: cliEnv(bin), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const kill = () => child.kill()
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, CLI_TIMEOUT_MS)
    signal?.addEventListener('abort', kill)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', (e) => reject(new Error(`Impossible de lancer Claude Code : ${e.message}`)))
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', kill)
      fs.rmSync(cwd, { recursive: true, force: true })
      if (timedOut) reject(new Error(`Claude Code n’a pas répondu en ${CLI_TIMEOUT_MS / 60_000} minutes (${label}). Réessaie, ou baisse l’effort dans Réglages.`))
      else if (signal?.aborted) reject(new Error('aborted'))
      else resolve({ code: code ?? 1, stdout, stderr })
    })
    child.stdin.end(input)
  })

  const result = out.stdout
    .split('\n')
    .reverse()
    .map((l) => {
      try {
        return JSON.parse(l) as { type?: string }
      } catch {
        return null
      }
    })
    .find((m): m is CliResult => m?.type === 'result')

  if (!result) {
    const detail = out.stderr.trim().split('\n').pop() || `code ${out.code}`
    throw new Error(`Claude Code s’est arrêté sans réponse (${label}) : ${detail}`)
  }
  if (result.is_error || result.subtype !== 'success') {
    const msg = result.result ?? ''
    if (/not logged in|\/login|invalid api key|oauth/i.test(msg)) throw new Error('Claude Code n’est pas connecté à ton abonnement. Lance « claude auth login » dans un terminal, puis réessaie.')
    if (result.api_error_status === 429 || /usage limit|rate limit/i.test(msg)) throw new Error(`Limite d’utilisation de ton abonnement Claude atteinte. ${msg}`.trim())
    if (result.subtype === 'error_max_structured_output_retries') throw new Error(`Réponse de Claude illisible (${label}).`)
    throw new Error(`Erreur Claude Code (${label}) : ${msg || result.subtype}`)
  }
  if (result.structured_output === undefined) throw new Error(`Réponse de Claude illisible (${label}).`)
  return result.structured_output
}
