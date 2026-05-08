import { useAuth, useUser } from '@clerk/react'
import { api } from '@deskbinder/convex-client'
import type { Id } from '@deskbinder/convex-client'
import type {
  AgentRunEvent,
  DesktopRepoSummary,
  LocalDeviceConfig,
  UpdateRepoInput,
  WorkspaceScriptRunInput
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
import { useRepoStateSync } from '../../hooks/useRepoStateSync'
import { useWorkerHeartbeat } from '../../hooks/useWorkerHeartbeat'
import { useBranchRequestRunner } from '../../hooks/useBranchRequestRunner'
import { useRemoteAgentJobRunner } from '../../hooks/useRemoteAgentJobRunner'

function getPathBasename(path: string): string {
  const normalizedPath = path.replace(/\/+$/, '')
  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || path
}

const convexUrl = import.meta.env.VITE_CONVEX_URL

function toDashboardRepo(repo: DesktopRepoSummary): DashboardRepo {
  return {
    id: repo.localRepoId,
    name: repo.name,
    repoPath: repo.repoPath,
    workspaceScriptPath: repo.workspaceScriptPath,
    defaultScriptArgs: repo.defaultScriptArgs,
    agentExecutable: repo.agentExecutable,
    sourceRepoId: repo.sourceLocalRepoId,
    workspaceBranchName: repo.workspaceBranchName,
    status: repo.isValid ? 'ready' : 'attention'
  }
}

function buildDashboardRepos(repos: DesktopRepoSummary[] | undefined): DashboardRepo[] {
  return (repos ?? []).map(toDashboardRepo)
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

type LocalClaimedAgentJob = {
  jobId: Id<'agentJobs'>
  attemptId: Id<'agentJobAttempts'>
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
  const { getToken, isSignedIn } = useAuth()
  const { user } = useUser()
  const { isAuthenticated } = useConvexAuth()
  const [{ api: desktopApi, error: initialBridgeError }] = useState(getInitialDesktopApiState)
  const [deviceConfig, setDeviceConfig] = useState<LocalDeviceConfig | null>(null)
  const [isLoadingConfig, setIsLoadingConfig] = useState(() => desktopApi !== null)
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
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
  const localJobByRunId = useRef(new Map<string, LocalClaimedAgentJob>())
  const workerId = deviceConfig?.workerId ?? null
  const remoteRepos = useQuery(
    api.repos.listDesktopRepos,
    isAuthenticated && workerId ? { workerId } : 'skip'
  ) as DesktopRepoSummary[] | undefined
  const repos = useMemo(() => buildDashboardRepos(remoteRepos), [remoteRepos])
  const resolvedSelectedRepoId =
    selectedRepoId && repos.some((repo) => repo.id === selectedRepoId)
      ? selectedRepoId
      : (repos[0]?.id ?? null)
  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === resolvedSelectedRepoId) ?? null,
    [repos, resolvedSelectedRepoId]
  )
  const { error: workerHeartbeatError } = useWorkerHeartbeat({
    deviceConfig,
    enabled: isAuthenticated,
    status: activeAgentRun ? 'busy' : 'online'
  })
  const { error: repoMetadataSyncError } = useRepoStateSync({
    deviceConfig,
    desktopApi,
    enabled: isAuthenticated
  })
  const handleRemoteBranchNotice = useCallback((notice: RepoSetupNotice) => {
    setRepoSetupNotice(notice)
  }, [])
  const { activeBranchName: remoteBranchName, error: branchRequestRunnerError } =
    useBranchRequestRunner({
      deviceConfig,
      desktopApi,
      enabled: isAuthenticated,
      onNotice: handleRemoteBranchNotice,
      onSelectedRepoId: setSelectedRepoId
    })
  const { activeJob: remoteAgentJob, error: remoteAgentJobRunnerError } = useRemoteAgentJobRunner({
    deviceConfig,
    desktopApi,
    enabled: isAuthenticated,
    onNotice: handleRemoteBranchNotice
  })
  const remoteAgentJobs = useQuery(
    api.agentJobs.listRecentAgentJobs,
    isAuthenticated && workerId && activeRepo
      ? {
          targetWorkerId: workerId,
          targetRepoId: activeRepo.id
        }
      : 'skip'
  ) as RemoteAgentJobSummary[] | undefined
  const createAgentJob = useMutation(api.agentJobs.createAgentJob)
  const claimAgentJob = useMutation(api.agentJobs.claimAgentJob)
  const markAgentJobRunning = useMutation(api.agentJobs.markAgentJobRunning)
  const completeAgentJob = useMutation(api.agentJobs.completeAgentJob)
  const interruptAgentJob = useMutation(api.agentJobs.interruptAgentJob)
  const answerHumanInputRequest = useMutation(api.agentJobs.answerHumanInputRequest)

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    let isMounted = true

    void desktopApi
      .getDeviceConfig()
      .then((nextConfig) => {
        if (!isMounted) {
          return
        }

        setDeviceConfig(nextConfig)
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setBridgeError(
          error instanceof Error ? error.message : 'Unable to load local deskbinder device config.'
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
    if (!desktopApi || !isSignedIn || !convexUrl) {
      void desktopApi?.clearConvexSession()
      return
    }

    let isActive = true

    const syncSession = async (): Promise<void> => {
      try {
        const authToken = await getToken({ template: 'convex' })

        if (!authToken || !isActive) {
          return
        }

        await desktopApi.setConvexSession({
          convexUrl,
          authToken
        })
        setBridgeError(null)
      } catch (error) {
        if (isActive) {
          setBridgeError(
            error instanceof Error ? error.message : 'Unable to prepare Convex desktop session.'
          )
        }
      }
    }

    void syncSession()

    const intervalId = window.setInterval(() => {
      void syncSession()
    }, 60_000)

    return () => {
      isActive = false
      window.clearInterval(intervalId)
    }
  }, [desktopApi, getToken, isSignedIn])

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
      const localJob = localJobByRunId.current.get(completedEvent.runId)

      if (localJob && workerId) {
        localJobByRunId.current.delete(completedEvent.runId)
        void (
          completedEvent.status === 'interrupted'
            ? interruptAgentJob({
                jobId: localJob.jobId,
                attemptId: localJob.attemptId,
                workerId,
                runId: completedEvent.runId,
                codexThreadId: completedEvent.codexThreadId,
                promptText:
                  completedEvent.humanInputPrompt ??
                  completedEvent.lastMessage ??
                  'Codex needs human input before it can continue.',
                resultSummary: completedEvent.lastMessage
              })
            : completeAgentJob({
                jobId: localJob.jobId,
                attemptId: localJob.attemptId,
                workerId,
                status: completedEvent.status,
                exitCode: completedEvent.exitCode,
                signal: completedEvent.signal,
                errorMessage: completedEvent.errorMessage,
                resultSummary: completedEvent.lastMessage
              })
        ).catch(() => {
          setRepoSetupNotice({
            tone: 'error',
            message: 'Codex finished locally, but its Convex job summary could not be saved.'
          })
        })
      }

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
  }, [completeAgentJob, desktopApi, interruptAgentJob, workerId])

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
        setRepoSetupNotice(null)

        try {
          const addedRepo = await api.createRemoteRepo({
            name: getPathBasename(result.path),
            repoPath: result.path
          })

          setSelectedRepoId(addedRepo.localRepoId)
          setRepoSetupNotice({
            tone: 'success',
            message: `Added ${addedRepo.name ?? getPathBasename(result.path)} to this account.`
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
      await getDesktopApi().updateRemoteRepoSettings(nextRepo)
      setBridgeError(null)
    } catch (error) {
      setRepoSetupNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save repo settings.'
      })
    }
  }

  async function handleDeleteWorkspace(repo: DashboardRepo): Promise<void> {
    setIsDeletingWorkspace(true)

    try {
      const response = await getDesktopApi().deleteWorkspace({
        repoId: repo.id
      })

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

  async function handleRunWorkspaceScripts({
    workspaces
  }: {
    workspaces: WorkspaceScriptRunInput[]
  }): Promise<void> {
    const targetRepo = repoForWorkspaceScript ?? activeRepo

    if (!targetRepo) {
      return
    }

    setIsRunningWorkspaceScript(true)

    try {
      const response = await getDesktopApi().runWorkspaceScripts({
        repoId: targetRepo.id,
        workspaces
      })
      const nextSelectedRepoId = response.selectedRepoId ?? targetRepo.id
      const successfulResults = response.results.filter((result) => result.result.ok)
      const firstFailure = response.results.find((result) => !result.result.ok)

      setSelectedRepoId(nextSelectedRepoId)
      setRepoForWorkspaceScript(null)
      setIsRunWorkspaceDialogOpen(false)
      setRepoSetupNotice(() => {
        if (successfulResults.length === response.results.length) {
          return {
            tone: 'success',
            message: `Created ${successfulResults.length} of ${response.results.length} workspaces.`
          }
        }

        if (successfulResults.length > 0) {
          return {
            tone: 'warning',
            message: `Created ${successfulResults.length} of ${response.results.length} workspaces.`
          }
        }

        return {
          tone: 'error',
          message: firstFailure?.result.errorMessage ?? 'Workspace script failed.'
        }
      })
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

    if (!targetRepo || !promptText || activeAgentRun || !workerId) {
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
      const createdJob = await createAgentJob({
        targetWorkerId: workerId,
        targetRepoId: targetRepo.id,
        promptText
      })
      const claimedJob = (await claimAgentJob({
        jobId: createdJob.jobId,
        workerId
      })) as LocalClaimedAgentJob | null

      if (!claimedJob) {
        throw new Error('Codex job could not be claimed.')
      }

      const response = await getDesktopApi().runAgent({
        repoId: targetRepo.id,
        promptText,
        resumeThreadId: interruptedRun?.codexThreadId
      })

      if (!response.ok) {
        await completeAgentJob({
          jobId: claimedJob.jobId,
          attemptId: claimedJob.attemptId,
          workerId,
          status: 'failed',
          errorMessage: response.errorMessage
        })
        setRepoSetupNotice({
          tone: 'error',
          message: response.errorMessage
        })
        return
      }

      localJobByRunId.current.set(response.runId, {
        jobId: claimedJob.jobId,
        attemptId: claimedJob.attemptId
      })
      await markAgentJobRunning({
        jobId: claimedJob.jobId,
        attemptId: claimedJob.attemptId,
        workerId,
        runId: response.runId
      })
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
        <div className="text-sm text-slate-300/80">Loading deskbinder device config...</div>
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
            Reload the window or restart the app. If this keeps happening, the preload bridge,
            Convex session, or local device config handler is failing before the dashboard mounts.
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
            isPickingFolder={isPickingFolder}
            onOpenSettings={handleOpenSettings}
            onNewWorkspace={handleOpenRunWorkspaceDialogForRepo}
            onSelectRepo={setSelectedRepoId}
            onSetupRepo={() => void handlePickFolder()}
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
        onSubmit={(input) => void handleRunWorkspaceScripts(input)}
        open={isRunWorkspaceDialogOpen}
        repo={repoForWorkspaceScript ?? activeRepo}
      />
    </>
  )
}
