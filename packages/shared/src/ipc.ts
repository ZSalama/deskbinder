import type {
  AgentRunEvent,
  CancelAgentRunInput,
  CancelAgentRunResponse,
  ConvexSessionInput,
  CreateRepoInput,
  DeleteWorkspaceInput,
  DeleteWorkspaceResponse,
  DesktopRepoSummary,
  DevEnvironmentStatus,
  GetDevEnvironmentStatusInput,
  LocalDeviceConfig,
  OpenDevEnvironmentInput,
  OpenDevEnvironmentResponse,
  OpenRepoTerminalInput,
  OpenRepoTerminalResponse,
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
  runWorkspaceScript: (input: RunWorkspaceScriptInput) => Promise<RunWorkspaceScriptResponse>
  runWorkspaceScripts: (input: RunWorkspaceScriptsInput) => Promise<RunWorkspaceScriptsResponse>
  deleteWorkspace: (input: DeleteWorkspaceInput) => Promise<DeleteWorkspaceResponse>
  getDevEnvironmentStatus: (
    input: GetDevEnvironmentStatusInput
  ) => Promise<DevEnvironmentStatus>
  openDevEnvironment: (input: OpenDevEnvironmentInput) => Promise<OpenDevEnvironmentResponse>
  openRepoTerminal: (input: OpenRepoTerminalInput) => Promise<OpenRepoTerminalResponse>
  runAgent: (input: RunAgentInput) => Promise<RunAgentResponse>
  cancelAgent: (input: CancelAgentRunInput) => Promise<CancelAgentRunResponse>
  onAgentEvent: (handler: (event: AgentRunEvent) => void) => () => void
}
