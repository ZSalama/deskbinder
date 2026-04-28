export type RepoStatus = 'ready' | 'attention' | 'idle'

export type DashboardRepo = {
  id: string
  kind: 'main' | 'slave'
  name: string
  parentRepoId: string | null
  path: string
  status: RepoStatus
}

export type TranscriptItem = {
  id: string
  role: 'user' | 'assistant' | 'system'
  body: string
  timestampLabel?: string
}
