import type { RepoSettings } from '@deskbinder/shared/deskbinder'

export type RepoStatus = 'ready' | 'attention'

export type DashboardRepo = RepoSettings & {
  status: RepoStatus
}

export type TranscriptItem = {
  id: string
  role: 'user' | 'assistant'
  body: string
  completedAtLabel?: string
  durationLabel?: string
  timestampLabel?: string
}
