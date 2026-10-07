import type { RushcutApi } from '../../preload/index'

declare global {
  interface Window {
    rushcut: RushcutApi
    __rcSetup?: (payload: unknown) => Promise<void>
    __rcSeek?: (t: number) => Promise<void>
  }
}
export {}
