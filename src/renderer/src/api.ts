import type {
  ClaudeCodeStatus, Comment, DesignSystem, Edl, ExportOptions, Illustration, JobState, Project, ProjectBundle, PublicSettings, Recipe, Settings, Word
} from '../../shared/types'

const c = <T,>(ch: string, ...a: unknown[]) => window.rushcut.call<T>(ch, ...a)

export const api = {
  settings: () => c<PublicSettings>('settings:get'),
  setSettings: (p: Partial<Settings>) => c<PublicSettings>('settings:set', p),
  claudeCodeStatus: () => c<ClaudeCodeStatus>('settings:claudeCode'),
  pickProjectsDir: () => c<PublicSettings | null>('settings:pickDir'),
  designSystems: () => c<DesignSystem[]>('ds:list'),
  saveDesignSystem: (d: DesignSystem) => c<DesignSystem[]>('ds:save', d),
  deleteDesignSystem: (id: string) => c<DesignSystem[]>('ds:delete', id),
  designSystemFromImage: () => c<DesignSystem | null>('ds:fromImage'),
  projects: () => c<Project[]>('projects:list'),
  createProject: (file?: string) => c<Project | null>('projects:create', file),
  deleteProject: (id: string) => c<void>('projects:delete', id),
  revealProject: (id: string) => c<void>('projects:reveal', id),
  bundle: (id: string) => c<ProjectBundle>('project:bundle', id),
  updateProject: (id: string, p: Partial<Project>) => c<Project>('project:update', id, p),
  saveEdl: (id: string, e: Edl) => c<void>('project:saveEdl', id, e),
  saveComments: (id: string, cm: Comment[]) => c<void>('project:saveComments', id, cm),
  saveWords: (id: string, w: Word[]) => c<void>('project:saveWords', id, w),
  saveFrame: (id: string, cid: string, dataUrl: string) => c<string>('project:saveFrame', id, cid, dataUrl),
  addIllustrations: (id: string, files?: string[]) => c<Illustration[] | null>('assets:add', id, files),
  removeIllustration: (id: string, file: string) => c<Illustration[]>('assets:remove', id, file),
  transcribe: (id: string) => c<void>('project:transcribe', id),
  resumeImport: (id: string) => c<void>('project:resumeImport', id),
  generate: (id: string, base: string | null, ds: string) => c<string>('ai:generate', id, base, ds),
  reference: (id: string) => c<Recipe | null>('ai:reference', id),
  exportVideo: (id: string, o: ExportOptions) => c<string>('export:start', id, o),
  reveal: (p: string) => c<void>('shell:reveal', p),
  jobs: () => c<JobState[]>('jobs:list'),
  dismissJob: (id: string) => c<void>('jobs:dismiss', id),
  cancelJob: (id: string) => c<void>('jobs:cancel', id)
}

export const mediaUrl = (projectId: string, file: string, bust?: string | number) =>
  `rushcut://p/${encodeURIComponent(projectId)}/${file}${bust !== undefined ? `?v=${bust}` : ''}`
