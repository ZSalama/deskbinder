import type { DeskbinderApi } from '@deskbinder/shared/ipc'

declare global {
  interface Window {
    api: DeskbinderApi
  }
}
