import type { RepoSettings } from '@deskbinder/shared/deskbinder'

export type RepoStatus = 'ready' | 'attention'

export type DashboardRepo = RepoSettings & {
  status: RepoStatus
}

export type TranscriptItem = {
  id: string
  role: 'user' | 'assistant' | 'system'
  body: string
  timestampLabel?: string
}
