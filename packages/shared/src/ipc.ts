import type {
  AgentRunEvent,
  AppSettings,
  CancelAgentRunInput,
  CancelAgentRunResponse,
  CreateRepoInput,
  DeleteWorkspaceInput,
  DeleteWorkspaceResponse,
  DeskbinderConfig,
  RepoSyncMetadataResponse,
  RunAgentInput,
  RunAgentResponse,
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
  getRepoSyncMetadata: () => Promise<RepoSyncMetadataResponse>
  runWorkspaceScript: (input: RunWorkspaceScriptInput) => Promise<RunWorkspaceScriptResponse>
  deleteWorkspace: (input: DeleteWorkspaceInput) => Promise<DeleteWorkspaceResponse>
  runAgent: (input: RunAgentInput) => Promise<RunAgentResponse>
  cancelAgent: (input: CancelAgentRunInput) => Promise<CancelAgentRunResponse>
  onAgentEvent: (handler: (event: AgentRunEvent) => void) => () => void
}
