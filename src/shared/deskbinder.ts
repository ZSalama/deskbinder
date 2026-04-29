export type RepoSettings = {
  id: string
  name: string
  repoPath: string
  workspaceScriptPath: string
  defaultScriptArgs?: string
  agentExecutable?: string
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
