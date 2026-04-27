export const IPC_CHANNELS = {
  ping: 'v1.system.ping',
  getVersions: 'v1.system.getVersions',
  pickFolder: 'v1.dialog.pickFolder'
} as const

export interface AppVersions {
  chrome: string
  electron: string
  node: string
}

export interface FolderPickResult {
  canceled: boolean
  path: string | null
}

export interface DeskbinderApi {
  ping: () => Promise<string>
  getVersions: () => Promise<AppVersions>
  pickFolder: () => Promise<FolderPickResult>
}
