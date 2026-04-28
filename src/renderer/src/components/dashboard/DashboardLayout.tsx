import { useUser } from '@clerk/react'
import { useMemo, useState } from 'react'
import { RepoSettingsDialog } from './RepoSettingsDialog'
import { RepoSidebar } from './RepoSidebar'
import { EmptyWorkspaceState } from './EmptyWorkspaceState'
import { PromptComposer } from './PromptComposer'
import { TranscriptPanel } from './TranscriptPanel'
import { WorkspaceHeader } from './WorkspaceHeader'
import type { DashboardRepo, TranscriptItem } from './types'

const initialRepos: DashboardRepo[] = [
  {
    id: 'repo-deskbinder',
    kind: 'main',
    name: 'deskbinder',
    parentRepoId: null,
    path: '/home/zack/Documents/web_dev/deskbinder',
    status: 'ready'
  },
  {
    id: 'repo-deskbinder-main',
    kind: 'slave',
    name: 'main',
    parentRepoId: 'repo-deskbinder',
    path: '/home/zack/Documents/web_dev/deskbinder',
    status: 'ready'
  },
  {
    id: 'repo-deskbinder-feature-agent-shell',
    kind: 'slave',
    name: 'feature/agent-shell',
    parentRepoId: 'repo-deskbinder',
    path: '/home/zack/Documents/web_dev/deskbinder/.worktrees/feature-agent-shell',
    status: 'attention'
  },
  {
    id: 'repo-docs-site',
    kind: 'main',
    name: 'docs-site',
    parentRepoId: null,
    path: '/home/zack/Documents/web_dev/docs-site',
    status: 'idle'
  },
  {
    id: 'repo-docs-site-main',
    kind: 'slave',
    name: 'main',
    parentRepoId: 'repo-docs-site',
    path: '/home/zack/Documents/web_dev/docs-site',
    status: 'idle'
  }
]

function buildTranscript(repo: DashboardRepo): TranscriptItem[] {
  return [
    {
      id: `${repo.id}-user`,
      role: 'user',
      timestampLabel: 'Draft prompt',
      body: 'Set up the dashboard shell for this repository. Keep the repo list visible, preserve the auth gate, and make the composer look like a real Codex entry point.'
    },
    {
      id: `${repo.id}-assistant`,
      role: 'assistant',
      timestampLabel: 'Placeholder Codex response',
      body: 'Workspace acknowledged. The current UI pass stops at layout, local state, and safe renderer-side interactions. No agent process will start yet.'
    },
    {
      id: `${repo.id}-system`,
      role: 'system',
      timestampLabel: 'Workspace status',
      body: 'Main process boundary preserved. Folder picker is available through preload. Repo persistence, validation, and execution wiring are intentionally deferred.'
    }
  ]
}

export function DashboardLayout(): React.JSX.Element {
  const { user } = useUser()
  const [repos, setRepos] = useState<DashboardRepo[]>(initialRepos)
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(initialRepos[1]?.id ?? null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [repoForSettings, setRepoForSettings] = useState<DashboardRepo | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [jobHint, setJobHint] = useState<string | null>(null)

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId) ?? null,
    [repos, selectedRepoId]
  )

  const transcript = activeRepo ? buildTranscript(activeRepo) : []

  async function handlePickFolder(): Promise<void> {
    setIsPickingFolder(true)

    try {
      const result = await window.api.pickFolder()

      if (!result.canceled) {
        setSelectedFolder(result.path)
      }
    } finally {
      setIsPickingFolder(false)
    }
  }

  function handleOpenSettings(repo: DashboardRepo): void {
    setRepoForSettings(repo)
    setIsSettingsOpen(true)
  }

  function handleSaveRepo(nextRepo: DashboardRepo): void {
    setRepos((currentRepos) =>
      currentRepos.map((repo) => (repo.id === nextRepo.id ? nextRepo : repo))
    )
  }

  function handleNewJob(): void {
    setJobHint('New Job is a placeholder in this UI pass. No draft or process starts yet.')
  }

  return (
    <>
      <section className="mx-auto flex h-full min-h-0 w-full min-w-[1024px] max-w-[1400px] flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-5">
          <RepoSidebar
            accountEmail={user?.primaryEmailAddress?.emailAddress ?? 'unknown email'}
            accountName={user?.fullName ?? user?.username ?? 'Account'}
            isPickingFolder={isPickingFolder}
            lastPickedFolder={selectedFolder}
            onOpenSettings={handleOpenSettings}
            onSelectRepo={setSelectedRepoId}
            onSetupRepo={() => void handlePickFolder()}
            repos={repos}
            selectedRepoId={selectedRepoId}
          />

          <section className="flex min-h-[720px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/72 shadow-[0_28px_100px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
            <WorkspaceHeader activeRepo={activeRepo} onNewJob={handleNewJob} />

            {jobHint ? (
              <div className="border-b border-cyan-300/12 bg-cyan-300/7 px-6 py-3 text-sm text-cyan-50">
                {jobHint}
              </div>
            ) : null}

            {activeRepo ? <TranscriptPanel items={transcript} /> : <EmptyWorkspaceState />}

            <PromptComposer
              disabled={!activeRepo}
              prompt={draftPrompt}
              setPrompt={(value) => setDraftPrompt(value)}
            />
          </section>
        </div>
      </section>

      <RepoSettingsDialog
        onOpenChange={setIsSettingsOpen}
        onSave={handleSaveRepo}
        open={isSettingsOpen}
        repo={repoForSettings}
      />
    </>
  )
}
