import type {
  AgentRunEvent,
  AppSettings,
  CancelAgentRunInput,
  CancelAgentRunResponse,
  ConvexSessionInput,
  CreateRepoInput,
  DeleteWorkspaceInput,
  DeleteWorkspaceResponse,
  DeskbinderConfig,
  DesktopRepoSummary,
  LocalDeviceConfig,
  RepoSyncMetadataResponse,
  RunAgentInput,
  RunAgentResponse,
  RunWorkspaceScriptInput,
  RunWorkspaceScriptResponse,
  RunWorkspaceScriptsInput,
  RunWorkspaceScriptsResponse,
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
  setConvexSession: (input: ConvexSessionInput) => Promise<void>
  clearConvexSession: () => Promise<void>
  getDeviceConfig: () => Promise<LocalDeviceConfig>
  createRemoteRepo: (input: CreateRepoInput) => Promise<DesktopRepoSummary>
  updateRemoteRepoSettings: (input: UpdateRepoInput) => Promise<DesktopRepoSummary>
  syncRepoStates: () => Promise<DesktopRepoSummary[]>
  updateWorkerSettings: (
    autoRunEnabled: AppSettings['autoRunEnabled']
  ) => Promise<{ autoRunEnabled: boolean }>
  getLocalConfig: () => Promise<DeskbinderConfig>
  createRepo: (input: CreateRepoInput) => Promise<DeskbinderConfig>
  updateRepo: (input: UpdateRepoInput) => Promise<DeskbinderConfig>
  updateAppSettings: (autoRunEnabled: AppSettings['autoRunEnabled']) => Promise<DeskbinderConfig>
  getRepoSyncMetadata: () => Promise<RepoSyncMetadataResponse>
  runWorkspaceScript: (input: RunWorkspaceScriptInput) => Promise<RunWorkspaceScriptResponse>
  runWorkspaceScripts: (input: RunWorkspaceScriptsInput) => Promise<RunWorkspaceScriptsResponse>
  deleteWorkspace: (input: DeleteWorkspaceInput) => Promise<DeleteWorkspaceResponse>
  runAgent: (input: RunAgentInput) => Promise<RunAgentResponse>
  cancelAgent: (input: CancelAgentRunInput) => Promise<CancelAgentRunResponse>
  onAgentEvent: (handler: (event: AgentRunEvent) => void) => () => void
}
