import type {
  AppSettings,
  CreateRepoInput,
  DeleteWorkspaceInput,
  DeleteWorkspaceResponse,
  DeskbinderConfig,
  RunWorkspaceScriptInput,
  RunWorkspaceScriptResponse,
  UpdateRepoInput
} from './deskbinder'

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
  updateRepo: (input: UpdateRepoInput) => Promise<DeskbinderConfig>
  updateAppSettings: (autoRunEnabled: AppSettings['autoRunEnabled']) => Promise<DeskbinderConfig>
  runWorkspaceScript: (input: RunWorkspaceScriptInput) => Promise<RunWorkspaceScriptResponse>
  deleteWorkspace: (input: DeleteWorkspaceInput) => Promise<DeleteWorkspaceResponse>
}
