import type { DeskbinderApi } from '../shared/ipc'

declare global {
  interface Window {
    api: DeskbinderApi
  }
}
