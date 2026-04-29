import { useUser } from '@clerk/react'
import { useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../../../convex/_generated/api'
import { RepoSettingsDialog } from './RepoSettingsDialog'
import { RepoSidebar } from './RepoSidebar'
import { EmptyWorkspaceState } from './EmptyWorkspaceState'
import { PromptComposer } from './PromptComposer'
import { TranscriptPanel } from './TranscriptPanel'
import { WorkspaceHeader } from './WorkspaceHeader'
import type { DashboardRepo, TranscriptItem } from './types'
import type { DeskbinderConfig, RepoSettings } from '../../../../shared/deskbinder'

function getPathBasename(path: string): string {
  const normalizedPath = path.replace(/\/+$/, '')
  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || path
}

function toDashboardRepo(repo: RepoSettings): DashboardRepo {
  return {
    ...repo,
    status: repo.workspaceScriptPath.trim() ? 'ready' : 'attention'
  }
}

function buildDashboardRepos(config: DeskbinderConfig | null): DashboardRepo[] {
  return (config?.repos ?? []).map(toDashboardRepo)
}

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
      body: 'Main process boundary preserved. Folder picker, repo persistence, and add-repo validation now run through preload and main.'
    }
  ]
}

type RepoSetupNotice = {
  tone: 'error' | 'success'
  message: string
}

export function DashboardLayout(): React.JSX.Element {
  const { user } = useUser()
  const viewer = useQuery(api.auth.viewer, {})
  const [config, setConfig] = useState<DeskbinderConfig | null>(null)
  const [isLoadingConfig, setIsLoadingConfig] = useState(true)
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [repoForSettings, setRepoForSettings] = useState<DashboardRepo | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [jobHint, setJobHint] = useState<string | null>(null)
  const [repoSetupNotice, setRepoSetupNotice] = useState<RepoSetupNotice | null>(null)
  const repos = useMemo(() => buildDashboardRepos(config), [config])

  useEffect(() => {
    let isMounted = true

    void window.api
      .getLocalConfig()
      .then((nextConfig) => {
        if (!isMounted) {
          return
        }

        setConfig(nextConfig)
        setSelectedRepoId((currentSelectedRepoId) => currentSelectedRepoId ?? nextConfig.repos[0]?.id ?? null)
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingConfig(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!repos.length) {
      if (selectedRepoId !== null) {
        setSelectedRepoId(null)
      }
      return
    }

    if (!selectedRepoId || !repos.some((repo) => repo.id === selectedRepoId)) {
      setSelectedRepoId(repos[0]?.id ?? null)
    }
  }, [repos, selectedRepoId])

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId) ?? null,
    [repos, selectedRepoId]
  )

  const transcript = activeRepo ? buildTranscript(activeRepo) : []

  async function handlePickFolder(): Promise<void> {
    setIsPickingFolder(true)

    try {
      const result = await window.api.pickFolder()

      if (!result.canceled && result.path) {
        setSelectedFolder(result.path)
        setRepoSetupNotice(null)

        try {
          const nextConfig = await window.api.createRepo({
            name: getPathBasename(result.path),
            repoPath: result.path
          })

          const addedRepo = nextConfig.repos[nextConfig.repos.length - 1] ?? null
          setConfig(nextConfig)
          setSelectedRepoId(addedRepo?.id ?? nextConfig.repos[0]?.id ?? null)
          setRepoSetupNotice({
            tone: 'success',
            message: `Added ${addedRepo?.name ?? getPathBasename(result.path)} to local deskbinder config.`
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to add that repository.'
          setRepoSetupNotice({
            tone: 'error',
            message
          })
        }
      }
    } finally {
      setIsPickingFolder(false)
    }
  }

  function handleOpenSettings(repo: DashboardRepo): void {
    setRepoForSettings(repo)
    setIsSettingsOpen(true)
  }

  async function handleSaveRepo(nextRepo: DashboardRepo): Promise<void> {
    const { status: _status, ...repoSettings } = nextRepo
    const nextConfig = await window.api.updateRepo(repoSettings)
    setConfig(nextConfig)
  }

  async function handleToggleAutoRun(nextValue: boolean): Promise<void> {
    const nextConfig = await window.api.updateAppSettings(nextValue)
    setConfig(nextConfig)
  }

  function handleNewJob(): void {
    setJobHint('New Job is a placeholder in this UI pass. No draft or process starts yet.')
  }

  if (isLoadingConfig) {
    return (
      <section className="mx-auto flex h-full min-h-0 w-full min-w-[1024px] max-w-[1400px] items-center justify-center">
        <div className="text-sm text-slate-300/80">Loading local deskbinder config...</div>
      </section>
    )
  }

  return (
    <>
      <section className="mx-auto flex h-full min-h-0 w-full min-w-[1024px] max-w-[1400px] flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-5">
          <RepoSidebar
            accountEmail={user?.primaryEmailAddress?.emailAddress ?? 'unknown email'}
            accountName={user?.fullName ?? user?.username ?? 'Account'}
            autoRunEnabled={config?.appSettings.autoRunEnabled ?? false}
            isPickingFolder={isPickingFolder}
            lastPickedFolder={selectedFolder}
            onOpenSettings={handleOpenSettings}
            onSelectRepo={setSelectedRepoId}
            onSetupRepo={() => void handlePickFolder()}
            onToggleAutoRun={(nextValue) => void handleToggleAutoRun(nextValue)}
            repos={repos}
            selectedRepoId={selectedRepoId}
          />

          <section className="flex min-h-[720px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/72 shadow-[0_28px_100px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
            <WorkspaceHeader
              activeRepo={activeRepo}
              authEmail={viewer?.email ?? user?.primaryEmailAddress?.emailAddress ?? null}
              authReady={viewer !== undefined}
              onNewJob={handleNewJob}
            />

            {jobHint ? (
              <div className="border-b border-cyan-300/12 bg-cyan-300/7 px-6 py-3 text-sm text-cyan-50">
                {jobHint}
              </div>
            ) : null}

            {repoSetupNotice ? (
              <div
                className={
                  repoSetupNotice.tone === 'error'
                    ? 'border-b border-rose-300/12 bg-rose-300/7 px-6 py-3 text-sm text-rose-50'
                    : 'border-b border-emerald-300/12 bg-emerald-300/7 px-6 py-3 text-sm text-emerald-50'
                }
              >
                {repoSetupNotice.message}
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
        onSave={(repo) => void handleSaveRepo(repo)}
        open={isSettingsOpen}
        repo={repoForSettings}
      />
    </>
  )
}
