export type AgentExecutable = 'codex' | 'claude'

export const MAX_WORKSPACE_BATCH_COUNT = 5

export type TrackedWorkspaceProcess = {
  pid: number
  startTimeTicks: number
  cwdPath?: string
}

export type TrackedWorkspace = {
  repoId: string
  repoPath: string
  sourceRepoPath?: string
  workspaceBranchName?: string
  workspaceProcesses?: TrackedWorkspaceProcess[]
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

export type RepoReadinessStatus =
  | 'ready'
  | 'invalid'
  | 'dirty'
  | 'missing_script'
  | 'missing_repo'
  | 'error'

export type DesktopRepoSummary = {
  desktopRepoId: string
  workerId: string
  localRepoId: string
  sourceLocalRepoId?: string
  name: string
  repoPath: string
  workspaceScriptPath: string
  defaultScriptArgs?: string
  agentExecutable: AgentExecutable
  currentBranch: string
  workspaceBranchName?: string
  isValid: boolean
  readinessStatus: RepoReadinessStatus
  readinessMessage: string | null
  lastSeenAt: number
}

export type LocalDeviceConfig = {
  workerId: string
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

export type DeskbinderConfig = {
  workerId: string
  trackedWorkspaces: TrackedWorkspace[]
}

export type CreateRepoInput = {
  name: string
  repoPath: string
}

export type UpdateRepoInput = {
  id?: string
  localRepoId?: string
  name: string
  workspaceScriptPath: string
  defaultScriptArgs?: string
  agentExecutable?: AgentExecutable
}

export type ConvexSessionInput = {
  convexUrl: string
  authToken: string
}

export type RunWorkspaceScriptInput = {
  repoId: string
  branchName: string
  defaultScriptArgs?: string
  autoStartDevEnvironment?: boolean
}

export type WorkspaceScriptRunInput = {
  branchName: string
  scriptArgs?: string
}

export type RunWorkspaceScriptsInput = {
  repoId: string
  autoStartDevEnvironment?: boolean
  workspaces: WorkspaceScriptRunInput[]
}

export type DeleteWorkspaceInput = {
  repoId: string
}

export type AgentRunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'interrupted'

export type RunAgentInput = {
  repoId: string
  promptText: string
  resumeThreadId?: string
}

export type RunAgentResponse =
  | {
      ok: true
      runId: string
      repoId: string
      status: 'running'
      codexThreadId?: string
    }
  | {
      ok: false
      errorMessage: string
    }

export type CancelAgentRunInput = {
  runId: string
}

export type CancelAgentRunResponse = {
  ok: boolean
  runId: string
  status: AgentRunStatus
  errorMessage?: string
}

export type AgentRunEvent =
  | {
      type: 'started'
      runId: string
      repoId: string
      startedAt: number
    }
  | {
      type: 'stdout' | 'stderr'
      runId: string
      chunk: string
      sequence: number
    }
  | {
      type: 'completed'
      runId: string
      repoId: string
      status: Exclude<AgentRunStatus, 'running'>
      exitCode?: number
      signal?: string
      errorMessage?: string
      lastMessage?: string
      codexThreadId?: string
      humanInputPrompt?: string
      completedAt: number
      stdoutTruncated: boolean
      stderrTruncated: boolean
    }

export type RunWorkspaceScriptResponse = {
  config?: DeskbinderConfig
  result: WorkspaceScriptResult
  selectedRepoId: string | null
}

export type WorkspaceScriptRunResponse = {
  index: number
  branchName: string
  result: WorkspaceScriptResult
  selectedRepoId: string | null
}

export type RunWorkspaceScriptsResponse = {
  config?: DeskbinderConfig
  results: WorkspaceScriptRunResponse[]
  selectedRepoId: string | null
}

export type DeleteWorkspaceResponse = {
  config?: DeskbinderConfig
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
