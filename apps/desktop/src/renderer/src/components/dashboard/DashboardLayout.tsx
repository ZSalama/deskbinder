import { useUser } from '@clerk/react'
import type {
  DeskbinderConfig,
  RepoSettings,
  UpdateRepoInput,
  WorkspaceScriptResult
} from '@deskbinder/shared/deskbinder'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { useConvexAuth } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import { RepoSettingsDialog } from './RepoSettingsDialog'
import { RepoSidebar } from './RepoSidebar'
import { EmptyWorkspaceState } from './EmptyWorkspaceState'
import { PromptComposer } from './PromptComposer'
import { RunWorkspaceDialog } from './RunWorkspaceDialog'
import { TranscriptPanel } from './TranscriptPanel'
import { WorkspaceHeader } from './WorkspaceHeader'
import type { DashboardRepo, TranscriptItem } from './types'

function getPathBasename(path: string): string {
  const normalizedPath = path.replace(/\/+$/, '')
  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || path
}

function toDashboardRepo(repo: RepoSettings): DashboardRepo {
  return {
    ...repo,
    status: 'ready'
  }
}

function buildDashboardRepos(config: DeskbinderConfig | null): DashboardRepo[] {
  return (config?.repos ?? []).filter((repo) => !repo.deleted).map(toDashboardRepo)
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

type WorkspaceScriptOutput = {
  repoId: string
  result: WorkspaceScriptResult
}

type DesktopApiState = {
  api: DeskbinderApi | null
  error: string | null
}

function getDesktopApi(): DeskbinderApi {
  const api = (window as Window & { api?: DeskbinderApi }).api

  if (!api) {
    throw new Error('The desktop bridge did not load. Restart the app and try again.')
  }

  return api
}

function getInitialDesktopApiState(): DesktopApiState {
  try {
    return {
      api: getDesktopApi(),
      error: null
    }
  } catch (error) {
    return {
      api: null,
      error:
        error instanceof Error
          ? error.message
          : 'The desktop bridge did not load. Restart the app and try again.'
    }
  }
}

export function DashboardLayout(): React.JSX.Element {
  const { user } = useUser()
  const { isAuthenticated } = useConvexAuth()
  const [{ api: desktopApi, error: initialBridgeError }] = useState(getInitialDesktopApiState)
  const [config, setConfig] = useState<DeskbinderConfig | null>(null)
  const [isLoadingConfig, setIsLoadingConfig] = useState(() => desktopApi !== null)
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [repoForSettings, setRepoForSettings] = useState<DashboardRepo | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isRunWorkspaceDialogOpen, setIsRunWorkspaceDialogOpen] = useState(false)
  const [isRunningWorkspaceScript, setIsRunningWorkspaceScript] = useState(false)
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(initialBridgeError)
  const [repoSetupNotice, setRepoSetupNotice] = useState<RepoSetupNotice | null>(null)
  const [workspaceScriptOutput, setWorkspaceScriptOutput] = useState<WorkspaceScriptOutput | null>(
    null
  )
  const repos = useMemo(() => buildDashboardRepos(config), [config])

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    let isMounted = true

    void desktopApi
      .getLocalConfig()
      .then((nextConfig) => {
        if (!isMounted) {
          return
        }

        setConfig(nextConfig)
        setSelectedRepoId(
          (currentSelectedRepoId) => currentSelectedRepoId ?? nextConfig.repos[0]?.id ?? null
        )
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setBridgeError(
          error instanceof Error ? error.message : 'Unable to load local deskbinder config.'
        )
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingConfig(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [desktopApi])
  const resolvedSelectedRepoId =
    selectedRepoId && repos.some((repo) => repo.id === selectedRepoId)
      ? selectedRepoId
      : (repos[0]?.id ?? null)

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === resolvedSelectedRepoId) ?? null,
    [repos, resolvedSelectedRepoId]
  )

  const transcript = activeRepo ? buildTranscript(activeRepo) : []

  async function handlePickFolder(): Promise<void> {
    let api: DeskbinderApi

    try {
      api = getDesktopApi()
      setBridgeError(null)
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'The desktop bridge is unavailable right now.'
      })
      return
    }

    setIsPickingFolder(true)

    try {
      const result = await api.pickFolder()

      if (!result.canceled && result.path) {
        setSelectedFolder(result.path)
        setRepoSetupNotice(null)

        try {
          const nextConfig = await api.createRepo({
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

  async function handleSaveRepo(nextRepo: UpdateRepoInput): Promise<void> {
    try {
      const nextConfig = await getDesktopApi().updateRepo(nextRepo)
      setConfig(nextConfig)
      setBridgeError(null)
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save repo settings.'
      })
    }
  }

  async function handleToggleAutoRun(nextValue: boolean): Promise<void> {
    try {
      const nextConfig = await getDesktopApi().updateAppSettings(nextValue)
      setConfig(nextConfig)
      setBridgeError(null)
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to update app settings.'
      })
    }
  }

  async function handleDeleteWorkspace(repo: DashboardRepo): Promise<void> {
    setIsDeletingWorkspace(true)

    try {
      const response = await getDesktopApi().deleteWorkspace({
        repoId: repo.id
      })

      setConfig(response.config)
      setSelectedRepoId(response.selectedRepoId)
      setWorkspaceScriptOutput((currentOutput) =>
        currentOutput?.repoId === response.deletedRepoId ? null : currentOutput
      )
      setRepoForSettings(null)
      setIsSettingsOpen(false)
      setRepoSetupNotice({
        tone: 'success',
        message: response.summary.message
      })
      setBridgeError(null)
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to delete that workspace.'
      })
    } finally {
      setIsDeletingWorkspace(false)
    }
  }

  function handleOpenRunWorkspaceDialog(): void {
    if (!activeRepo) {
      return
    }

    setIsRunWorkspaceDialogOpen(true)
  }

  async function handleRunWorkspaceScript(branchName: string): Promise<void> {
    if (!activeRepo) {
      return
    }

    setIsRunningWorkspaceScript(true)

    try {
      const response = await getDesktopApi().runWorkspaceScript({
        repoId: activeRepo.id,
        branchName
      })
      const nextSelectedRepoId = response.selectedRepoId ?? activeRepo.id

      setConfig(response.config)
      setSelectedRepoId(nextSelectedRepoId)
      setWorkspaceScriptOutput({
        repoId: nextSelectedRepoId,
        result: response.result
      })
      setIsRunWorkspaceDialogOpen(false)
      setRepoSetupNotice(
        response.result.ok
          ? {
              tone: 'success',
              message: `Workspace ready for branch ${response.result.branchName}.`
            }
          : {
              tone: 'error',
              message: response.result.errorMessage ?? 'Workspace script failed.'
            }
      )
      setBridgeError(null)
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Workspace script failed.'
      })
    } finally {
      setIsRunningWorkspaceScript(false)
    }
  }

  if (isLoadingConfig) {
    return (
      <section className="mx-auto flex h-full min-h-0 w-full min-w-[1024px] max-w-[1400px] items-center justify-center">
        <div className="text-sm text-slate-300/80">Loading local deskbinder config...</div>
      </section>
    )
  }

  if (bridgeError) {
    return (
      <section className="mx-auto flex h-full min-h-0 w-full min-w-[1024px] max-w-[1400px] items-center justify-center">
        <div className="w-full max-w-2xl rounded-[28px] border border-rose-300/18 bg-rose-300/8 p-8 text-slate-100 shadow-2xl backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-rose-200/72">
            Desktop Bridge Error
          </p>
          <h1 className="mt-4 text-2xl font-semibold text-white">The dashboard could not start.</h1>
          <p className="mt-4 text-sm leading-6 text-slate-200/82">{bridgeError}</p>
          <p className="mt-4 text-sm leading-6 text-slate-300/76">
            Reload the window or restart the app. If this keeps happening, the preload bridge or
            local config IPC handler is failing before the dashboard finishes mounting.
          </p>
        </div>
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
            selectedRepoId={resolvedSelectedRepoId}
          />

          <section className="flex min-h-[720px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/72 shadow-[0_28px_100px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
            <WorkspaceHeader
              activeRepo={activeRepo}
              authEmail={user?.primaryEmailAddress?.emailAddress ?? null}
              authReady={isAuthenticated}
              isRunningWorkspaceScript={isRunningWorkspaceScript}
              onNewWorkspace={handleOpenRunWorkspaceDialog}
            />

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

            {activeRepo &&
            workspaceScriptOutput &&
            workspaceScriptOutput.repoId === activeRepo.id ? (
              <div
                className={
                  workspaceScriptOutput.result.ok
                    ? 'border-b border-emerald-300/12 bg-emerald-300/6 px-6 py-5'
                    : 'border-b border-rose-300/12 bg-rose-300/6 px-6 py-5'
                }
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
                      Workspace Script Result
                    </p>
                    <p className="mt-2 text-sm text-slate-100">
                      {workspaceScriptOutput.result.ok
                        ? `Branch ${workspaceScriptOutput.result.branchName} completed.`
                        : `Branch ${workspaceScriptOutput.result.branchName} failed.`}
                    </p>
                  </div>
                </div>
                <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/72 p-4 text-xs leading-6 text-slate-200">
                  {JSON.stringify(workspaceScriptOutput.result, null, 2)}
                </pre>
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
        isDeletingWorkspace={isDeletingWorkspace}
        onDeleteWorkspace={(repo) => void handleDeleteWorkspace(repo)}
        onOpenChange={setIsSettingsOpen}
        onSave={(repo) => void handleSaveRepo(repo)}
        open={isSettingsOpen}
        repo={repoForSettings}
      />
      <RunWorkspaceDialog
        isSubmitting={isRunningWorkspaceScript}
        onOpenChange={setIsRunWorkspaceDialogOpen}
        onSubmit={(branchName) => void handleRunWorkspaceScript(branchName)}
        open={isRunWorkspaceDialogOpen}
        repo={activeRepo}
      />
    </>
  )
}
