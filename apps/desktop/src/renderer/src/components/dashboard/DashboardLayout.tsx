import { useUser } from '@clerk/react'
import { api } from '@deskbinder/convex-client'
import type { Id } from '@deskbinder/convex-client'
import type {
  AgentRunEvent,
  DeskbinderConfig,
  RepoSettings,
  UpdateRepoInput
} from '@deskbinder/shared/deskbinder'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RepoSettingsDialog } from './RepoSettingsDialog'
import { RepoSidebar } from './RepoSidebar'
import { EmptyWorkspaceState } from './EmptyWorkspaceState'
import { PromptComposer } from './PromptComposer'
import { RunWorkspaceDialog } from './RunWorkspaceDialog'
import { TranscriptPanel } from './TranscriptPanel'
import { WorkspaceHeader } from './WorkspaceHeader'
import type { DashboardRepo, TranscriptItem } from './types'
import { useRepoMetadataSync } from '../../hooks/useRepoMetadataSync'
import { useWorkerHeartbeat } from '../../hooks/useWorkerHeartbeat'
import { useBranchRequestRunner } from '../../hooks/useBranchRequestRunner'
import { useRemoteAgentJobRunner } from '../../hooks/useRemoteAgentJobRunner'

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

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

function getAgentCompletionNotice(event: Extract<AgentRunEvent, { type: 'completed' }>): string {
  switch (event.status) {
    case 'failed':
      return event.errorMessage ?? 'Codex failed.'
    case 'cancelled':
      return 'Codex run cancelled.'
    case 'timed_out':
      return 'Codex timed out.'
    case 'interrupted':
      return 'Codex is waiting for human input.'
    case 'succeeded':
      return 'Codex run completed.'
  }
}

type RepoSetupNotice = {
  tone: 'error' | 'success' | 'warning'
  message: string
}

type ActiveAgentRun = {
  repoId: string
  runId: string
}

type InterruptedAgentRun = {
  codexThreadId: string
  promptText: string
  runId: string
}

type TranscriptsByRepoId = Record<string, TranscriptItem[]>
type InterruptedRunsByRepoId = Record<string, InterruptedAgentRun | undefined>

type RemoteHumanInputRequest = {
  requestId: Id<'agentJobHumanInputRequests'>
  promptText: string
  createdAt: number
}

type RemoteAgentJobSummary = {
  jobId: Id<'agentJobs'>
  status: string
  pendingHumanInputRequest?: RemoteHumanInputRequest
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
  const [repoForWorkspaceScript, setRepoForWorkspaceScript] = useState<DashboardRepo | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isRunWorkspaceDialogOpen, setIsRunWorkspaceDialogOpen] = useState(false)
  const [isRunningWorkspaceScript, setIsRunningWorkspaceScript] = useState(false)
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(initialBridgeError)
  const [repoSetupNotice, setRepoSetupNotice] = useState<RepoSetupNotice | null>(null)
  const [transcriptsByRepoId, setTranscriptsByRepoId] = useState<TranscriptsByRepoId>({})
  const [activeAgentRun, setActiveAgentRun] = useState<ActiveAgentRun | null>(null)
  const [interruptedRunsByRepoId, setInterruptedRunsByRepoId] = useState<InterruptedRunsByRepoId>(
    {}
  )
  const [remoteHumanInputDraft, setRemoteHumanInputDraft] = useState('')
  const runRepoIdByRunId = useRef(new Map<string, string>())
  const repos = useMemo(() => buildDashboardRepos(config), [config])
  const resolvedSelectedRepoId =
    selectedRepoId && repos.some((repo) => repo.id === selectedRepoId)
      ? selectedRepoId
      : (repos[0]?.id ?? null)
  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === resolvedSelectedRepoId) ?? null,
    [repos, resolvedSelectedRepoId]
  )
  const { error: workerHeartbeatError } = useWorkerHeartbeat({
    config,
    enabled: isAuthenticated,
    status: activeAgentRun ? 'busy' : 'online'
  })
  const { error: repoMetadataSyncError } = useRepoMetadataSync({
    config,
    desktopApi,
    enabled: isAuthenticated
  })
  const handleRemoteBranchNotice = useCallback((notice: RepoSetupNotice) => {
    setRepoSetupNotice(notice)
  }, [])
  const { activeBranchName: remoteBranchName, error: branchRequestRunnerError } =
    useBranchRequestRunner({
      config,
      desktopApi,
      enabled: isAuthenticated,
      onConfigUpdated: setConfig,
      onNotice: handleRemoteBranchNotice,
      onSelectedRepoId: setSelectedRepoId
    })
  const { activeJob: remoteAgentJob, error: remoteAgentJobRunnerError } = useRemoteAgentJobRunner({
    config,
    desktopApi,
    enabled: isAuthenticated,
    onNotice: handleRemoteBranchNotice
  })
  const remoteAgentJobs = useQuery(
    api.agentJobs.listRecentAgentJobs,
    isAuthenticated && config?.workerId && activeRepo
      ? {
          targetWorkerId: config.workerId,
          targetRepoId: activeRepo.id
        }
      : 'skip'
  ) as RemoteAgentJobSummary[] | undefined
  const answerHumanInputRequest = useMutation(api.agentJobs.answerHumanInputRequest)

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

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    return desktopApi.onAgentEvent((event) => {
      if (event.type === 'started') {
        runRepoIdByRunId.current.set(event.runId, event.repoId)
        setActiveAgentRun({
          runId: event.runId,
          repoId: event.repoId
        })
        setTranscriptsByRepoId((currentTranscripts) => {
          const repoTranscript = currentTranscripts[event.repoId] ?? []

          if (repoTranscript.some((item) => item.id === `${event.runId}-assistant`)) {
            return currentTranscripts
          }

          return {
            ...currentTranscripts,
            [event.repoId]: [
              ...repoTranscript,
              {
                id: `${event.runId}-assistant`,
                role: 'assistant',
                body: '',
                status: 'running'
              }
            ]
          }
        })
        return
      }

      const repoId = runRepoIdByRunId.current.get(event.runId)

      if (!repoId) {
        return
      }

      if (event.type === 'stdout' || event.type === 'stderr') {
        setTranscriptsByRepoId((currentTranscripts) => {
          const repoTranscript = currentTranscripts[repoId] ?? []
          const itemId = `${event.runId}-assistant`
          const hasAssistantItem = repoTranscript.some((item) => item.id === itemId)
          const nextTranscript = (
            hasAssistantItem
              ? repoTranscript
              : [
                  ...repoTranscript,
                  {
                    id: itemId,
                    role: 'assistant' as const,
                    body: '',
                    status: 'running' as const
                  }
                ]
          ).map((item) => {
            if (item.id !== itemId) {
              return item
            }

            return event.type === 'stdout'
              ? {
                  ...item,
                  body: `${item.body}${event.chunk}`,
                  status: 'running' as const
                }
              : {
                  ...item,
                  stderrBody: `${item.stderrBody ?? ''}${event.chunk}`,
                  status: 'running' as const
                }
          })

          return {
            ...currentTranscripts,
            [repoId]: nextTranscript
          }
        })
        return
      }

      if (event.type !== 'completed') {
        return
      }

      const completedEvent = event

      setTranscriptsByRepoId((currentTranscripts) => {
        const repoTranscript = currentTranscripts[repoId] ?? []
        const itemId = `${completedEvent.runId}-assistant`
        const completionNotice = getAgentCompletionNotice(completedEvent)
        const hasAssistantItem = repoTranscript.some((item) => item.id === itemId)
        const nextTranscript = (
          hasAssistantItem
            ? repoTranscript
            : [
                ...repoTranscript,
                {
                  id: itemId,
                  role: 'assistant' as const,
                  body: '',
                  status: 'running' as const
                }
              ]
        ).map((item) => {
          if (item.id !== itemId) {
            return item
          }

          return {
            ...item,
            body: (completedEvent.lastMessage ?? item.body) || completionNotice,
            status: completedEvent.status,
            completedAtLabel: formatTimestamp(completedEvent.completedAt)
          }
        })

        return {
          ...currentTranscripts,
          [repoId]: nextTranscript
        }
      })
      setActiveAgentRun((currentRun) =>
        currentRun?.runId === completedEvent.runId ? null : currentRun
      )
      runRepoIdByRunId.current.delete(completedEvent.runId)

      if (completedEvent.status === 'interrupted' && completedEvent.codexThreadId) {
        setInterruptedRunsByRepoId((currentRuns) => ({
          ...currentRuns,
          [repoId]: {
            codexThreadId: completedEvent.codexThreadId!,
            promptText:
              completedEvent.humanInputPrompt ??
              completedEvent.lastMessage ??
              'Codex needs human input before it can continue.',
            runId: completedEvent.runId
          }
        }))
        setRepoSetupNotice({
          tone: 'warning',
          message: 'Codex is waiting for human input.'
        })
        return
      }

      if (completedEvent.status === 'succeeded') {
        setInterruptedRunsByRepoId((currentRuns) => ({
          ...currentRuns,
          [repoId]: undefined
        }))
      }

      if (completedEvent.status !== 'succeeded') {
        setRepoSetupNotice({
          tone: 'error',
          message: getAgentCompletionNotice(completedEvent)
        })
      }
    })
  }, [desktopApi])

  const transcript = activeRepo ? (transcriptsByRepoId[activeRepo.id] ?? []) : []
  const activeRepoHasAgentRun = !!activeRepo && activeAgentRun?.repoId === activeRepo.id
  const interruptedRun = activeRepo ? interruptedRunsByRepoId[activeRepo.id] : undefined
  const remoteHumanInputRequest = remoteAgentJobs?.find(
    (job) => job.status === 'interrupted' && job.pendingHumanInputRequest
  )?.pendingHumanInputRequest

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

    setRepoForWorkspaceScript(activeRepo)
    setIsRunWorkspaceDialogOpen(true)
  }

  function handleOpenRunWorkspaceDialogForRepo(repo: DashboardRepo): void {
    setSelectedRepoId(repo.id)
    setRepoForWorkspaceScript(repo)
    setIsRunWorkspaceDialogOpen(true)
  }

  async function handleRunWorkspaceScript(branchName: string): Promise<void> {
    const targetRepo = repoForWorkspaceScript ?? activeRepo

    if (!targetRepo) {
      return
    }

    setIsRunningWorkspaceScript(true)

    try {
      const response = await getDesktopApi().runWorkspaceScript({
        repoId: targetRepo.id,
        branchName
      })
      const nextSelectedRepoId = response.selectedRepoId ?? targetRepo.id

      setConfig(response.config)
      setSelectedRepoId(nextSelectedRepoId)
      setRepoForWorkspaceScript(null)
      setIsRunWorkspaceDialogOpen(false)
      setRepoSetupNotice(
        response.result.ok
          ? null
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

  async function handleSubmitPrompt(): Promise<void> {
    const targetRepo = activeRepo
    const promptText = draftPrompt.trim()

    if (!targetRepo || !promptText || activeAgentRun) {
      return
    }

    if (targetRepo.agentExecutable !== 'codex') {
      setRepoSetupNotice({
        tone: 'error',
        message: 'Only the Codex agent is supported right now.'
      })
      return
    }

    const submittedAt = Date.now()
    setTranscriptsByRepoId((currentTranscripts) => ({
      ...currentTranscripts,
      [targetRepo.id]: [
        ...(currentTranscripts[targetRepo.id] ?? []),
        {
          id: `${targetRepo.id}-${submittedAt}-user`,
          role: 'user',
          body: promptText,
          timestampLabel: formatTimestamp(submittedAt)
        }
      ]
    }))
    setRepoSetupNotice(null)

    try {
      const response = await getDesktopApi().runAgent({
        repoId: targetRepo.id,
        promptText,
        resumeThreadId: interruptedRun?.codexThreadId
      })

      if (!response.ok) {
        setRepoSetupNotice({
          tone: 'error',
          message: response.errorMessage
        })
        return
      }

      runRepoIdByRunId.current.set(response.runId, response.repoId)
      setActiveAgentRun({
        runId: response.runId,
        repoId: response.repoId
      })
      setTranscriptsByRepoId((currentTranscripts) => {
        const repoTranscript = currentTranscripts[response.repoId] ?? []

        if (repoTranscript.some((item) => item.id === `${response.runId}-assistant`)) {
          return currentTranscripts
        }

        return {
          ...currentTranscripts,
          [response.repoId]: [
            ...repoTranscript,
            {
              id: `${response.runId}-assistant`,
              role: 'assistant',
              body: '',
              status: 'running'
            }
          ]
        }
      })
      setDraftPrompt('')
      setInterruptedRunsByRepoId((currentRuns) => ({
        ...currentRuns,
        [targetRepo.id]: undefined
      }))
      setBridgeError(null)
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to start Codex.'
      })
    }
  }

  async function handleCancelAgent(): Promise<void> {
    const run = activeAgentRun

    if (!run || !activeRepo || run.repoId !== activeRepo.id) {
      return
    }

    try {
      const response = await getDesktopApi().cancelAgent({
        runId: run.runId
      })

      if (!response.ok) {
        setRepoSetupNotice({
          tone: 'error',
          message: response.errorMessage ?? 'Unable to cancel Codex.'
        })
      }
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to cancel Codex.'
      })
    }
  }

  async function handleRemoteHumanInputSubmit(): Promise<void> {
    const request = remoteHumanInputRequest
    const responseText = remoteHumanInputDraft.trim()

    if (!request || !responseText) {
      return
    }

    try {
      await answerHumanInputRequest({
        requestId: request.requestId,
        responseText
      })
      setRemoteHumanInputDraft('')
      setRepoSetupNotice({
        tone: 'success',
        message: 'Human input sent to the remote Codex job.'
      })
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to send human input.'
      })
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
      <section className="flex h-full min-h-0 w-full min-w-[1024px] flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-[352px_minmax(0,1fr)]">
          <RepoSidebar
            accountEmail={user?.primaryEmailAddress?.emailAddress ?? 'unknown email'}
            accountName={user?.fullName ?? user?.username ?? 'Account'}
            accountImageUrl={user?.imageUrl ?? null}
            autoRunEnabled={config?.appSettings.autoRunEnabled ?? false}
            isPickingFolder={isPickingFolder}
            lastPickedFolder={selectedFolder}
            onOpenSettings={handleOpenSettings}
            onNewWorkspace={handleOpenRunWorkspaceDialogForRepo}
            onSelectRepo={setSelectedRepoId}
            onSetupRepo={() => void handlePickFolder()}
            onToggleAutoRun={(nextValue) => void handleToggleAutoRun(nextValue)}
            repos={repos}
            selectedRepoId={resolvedSelectedRepoId}
          />

          <section className="flex min-h-0 flex-col overflow-hidden border-l border-white/10 bg-[#080d14]/88 shadow-[inset_1px_0_0_rgba(255,255,255,0.03)] backdrop-blur-2xl">
            <WorkspaceHeader
              activeRepo={activeRepo}
              authEmail={user?.primaryEmailAddress?.emailAddress ?? null}
              authReady={isAuthenticated}
              isAgentRunning={activeRepoHasAgentRun}
              isRunningWorkspaceScript={isRunningWorkspaceScript}
              onCancelAgent={() => void handleCancelAgent()}
              onNewWorkspace={handleOpenRunWorkspaceDialog}
            />

            {repoSetupNotice ? (
              <div
                className={
                  repoSetupNotice.tone === 'error'
                    ? 'border-b border-rose-300/12 bg-rose-300/7 px-6 py-3 text-sm text-rose-50'
                    : repoSetupNotice.tone === 'warning'
                      ? 'border-b border-amber-300/12 bg-amber-300/7 px-6 py-3 text-sm text-amber-50'
                      : 'border-b border-emerald-300/12 bg-emerald-300/7 px-6 py-3 text-sm text-emerald-50'
                }
              >
                {repoSetupNotice.message}
              </div>
            ) : null}

            {workerHeartbeatError ? (
              <div className="border-b border-amber-300/12 bg-amber-300/7 px-6 py-3 text-sm text-amber-50">
                {workerHeartbeatError}
              </div>
            ) : null}

            {repoMetadataSyncError ? (
              <div className="border-b border-amber-300/12 bg-amber-300/7 px-6 py-3 text-sm text-amber-50">
                {repoMetadataSyncError}
              </div>
            ) : null}

            {remoteBranchName ? (
              <div className="border-b border-blue-300/12 bg-blue-300/7 px-6 py-3 text-sm text-blue-50">
                Running remote branch request for {remoteBranchName}.
              </div>
            ) : null}

            {branchRequestRunnerError ? (
              <div className="border-b border-amber-300/12 bg-amber-300/7 px-6 py-3 text-sm text-amber-50">
                {branchRequestRunnerError}
              </div>
            ) : null}

            {remoteAgentJob ? (
              <div className="border-b border-blue-300/12 bg-blue-300/7 px-6 py-3 text-sm text-blue-50">
                Running remote agent job for repo {remoteAgentJob.targetRepoId.slice(0, 8)}.
              </div>
            ) : null}

            {remoteAgentJobRunnerError ? (
              <div className="border-b border-amber-300/12 bg-amber-300/7 px-6 py-3 text-sm text-amber-50">
                {remoteAgentJobRunnerError}
              </div>
            ) : null}

            {activeRepo ? <TranscriptPanel items={transcript} /> : <EmptyWorkspaceState />}

            {remoteHumanInputRequest ? (
              <form
                className="border-t border-amber-300/12 bg-amber-300/7 px-6 py-4 text-sm text-amber-50"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleRemoteHumanInputSubmit()
                }}
              >
                <p className="font-medium">Remote Codex needs input.</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-amber-50/86">
                  {remoteHumanInputRequest.promptText}
                </p>
                <div className="mt-3 flex items-end gap-2">
                  <textarea
                    className="min-h-18 flex-1 resize-none rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-200/50"
                    onChange={(event) => setRemoteHumanInputDraft(event.target.value)}
                    placeholder="Reply to Codex..."
                    value={remoteHumanInputDraft}
                  />
                  <button
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-amber-300 px-4 text-sm font-medium text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={!remoteHumanInputDraft.trim()}
                    type="submit"
                  >
                    Send Reply
                  </button>
                </div>
              </form>
            ) : null}

            {interruptedRun ? (
              <div className="border-t border-amber-300/12 bg-amber-300/7 px-6 py-3 text-sm text-amber-50">
                Codex asked for input: {interruptedRun.promptText}
              </div>
            ) : null}

            <PromptComposer
              disabled={
                !activeRepo || activeAgentRun !== null || activeRepo.agentExecutable !== 'codex'
              }
              isRunning={activeAgentRun !== null}
              agentExecutable={activeRepo?.agentExecutable ?? 'codex'}
              onSubmit={() => void handleSubmitPrompt()}
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
        onOpenChange={(open) => {
          setIsRunWorkspaceDialogOpen(open)

          if (!open) {
            setRepoForWorkspaceScript(null)
          }
        }}
        onSubmit={(branchName) => void handleRunWorkspaceScript(branchName)}
        open={isRunWorkspaceDialogOpen}
        repo={repoForWorkspaceScript ?? activeRepo}
      />
    </>
  )
}
