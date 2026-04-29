import type { CreateRepoInput, DeskbinderConfig, RepoSettings } from './deskbinder'

export const IPC_CHANNELS = {
  ping: 'v1.system.ping',
  getVersions: 'v1.system.getVersions',
  pickFolder: 'v1.dialog.pickFolder',
  getLocalConfig: 'v1.config.getLocalConfig',
  createRepo: 'v1.config.createRepo',
  updateRepo: 'v1.config.updateRepo',
  updateAppSettings: 'v1.config.updateAppSettings'
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
  getLocalConfig: () => Promise<DeskbinderConfig>
  createRepo: (input: CreateRepoInput) => Promise<DeskbinderConfig>
  updateRepo: (repo: RepoSettings) => Promise<DeskbinderConfig>
  updateAppSettings: (autoRunEnabled: boolean) => Promise<DeskbinderConfig>
}
