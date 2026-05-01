export type AgentExecutable = 'codex' | 'claude'

export type TrackedWorkspaceProcess = {
  pid: number
  startTimeTicks: number
  cwdPath?: string
}

export type RepoSettings = {
  id: string
  name: string
  repoPath: string
  workspaceScriptPath: string
  defaultScriptArgs?: string
  agentExecutable?: AgentExecutable
  deleted?: boolean
  sourceRepoId?: string
  sourceRepoPath?: string
  workspaceBranchName?: string
  workspaceProcesses?: TrackedWorkspaceProcess[]
}

export type WorkspaceScriptResult = {
  ok: boolean
  agentRunnable: boolean
  repoPath?: string
  workspacePath?: string
  workspaceName?: string
  branchName: string
  baseBranch?: string
  port?: number
  url?: string
  logs?: {
    workspace?: string
    dev?: string
    convex?: string
  }
  processes?: {
    dev?: number
    convex?: number
  }
  failureStep?: string
  errorMessage?: string
}

export type LocalJobStatus =
  | 'queued'
  | 'claimed'
  | 'setup_running'
  | 'setup_failed'
  | 'agent_running'
  | 'agent_failed'
  | 'agent_succeeded'
  | 'cancelled'
  | 'interrupted'

export type LocalJobIndex = {
  id: string
  repoId: string
  status: LocalJobStatus
  branchName?: string
  createdAt: number
  updatedAt: number
}

export type AppSettings = {
  autoRunEnabled: boolean
}

export type DeskbinderConfig = {
  workerId: string
  repos: RepoSettings[]
  jobs: LocalJobIndex[]
  appSettings: AppSettings
}

export type CreateRepoInput = {
  name: string
  repoPath: string
}

export type UpdateRepoInput = {
  id: string
  name: string
  workspaceScriptPath: string
  defaultScriptArgs?: string
  agentExecutable?: AgentExecutable
}

export type RunWorkspaceScriptInput = {
  repoId: string
  branchName: string
}

export type DeleteWorkspaceInput = {
  repoId: string
}

export type RunWorkspaceScriptResponse = {
  config: DeskbinderConfig
  result: WorkspaceScriptResult
  selectedRepoId: string | null
}

export type DeleteWorkspaceResponse = {
  config: DeskbinderConfig
  deletedRepoId: string | null
  selectedRepoId: string | null
  summary: {
    branchDeleted: boolean
    folderDeleted: boolean
    killedProcessCount: number
    message: string
    worktreePruned: boolean
  }
}
