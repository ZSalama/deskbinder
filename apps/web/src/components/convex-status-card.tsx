'use client'

import {
  SignInButton,
  SignOutButton,
  SignedIn,
  SignedOut,
  UserButton,
  useAuth
} from '@clerk/nextjs'
import { api } from '@deskbinder/convex-client'
import type { Id } from '@deskbinder/convex-client'
import { useMutation, useQuery } from 'convex/react'
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  CheckCircle2,
  Folder,
  GitBranch,
  Loader2,
  LogOut,
  Menu,
  Monitor,
  Pencil,
  Plus,
  SendHorizontal,
  Settings,
  Trash2,
  Workflow,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConvexProviders } from './providers'

const WORKER_ONLINE_THRESHOLD_MS = 90_000
const MAX_WORKSPACE_BATCH_COUNT = 5
const WORKSPACE_COUNTS = Array.from({ length: MAX_WORKSPACE_BATCH_COUNT }, (_, index) => index + 1)

type WorkspaceDraft = {
  branchName: string
  scriptArgs: string
}

type WorkspaceRequestInput = {
  branchName: string
  scriptArgs: string
}

type DesktopWorkerSummary = {
  workerId: string
  name: string
  status: 'online' | 'busy' | 'offline'
  lastSeenAt: number | null
}

type DesktopRepoSummary = {
  workerId: string
  localRepoId: string
  sourceLocalRepoId?: string
  name: string
  repoPath: string
  workspaceScriptPath: string
  defaultScriptArgs?: string
  agentExecutable: 'codex' | 'claude'
  currentBranch: string
  workspaceBranchName?: string
  isValid: boolean
  readinessStatus: 'ready' | 'invalid' | 'dirty' | 'missing_script' | 'missing_repo' | 'error'
  readinessMessage: string | null
  lastSeenAt: number
}

type DisplayWorkerStatus = 'Online' | 'Busy' | 'Offline'

type RepoGroup = {
  id: string
  name: string
  root: DesktopRepoSummary
  branches: DesktopRepoSummary[]
}

type RemoteNotice = {
  tone: 'error' | 'success' | 'warning'
  message: string
}

type RemoteAgentJobStatus =
  | 'queued'
  | 'claimed'
  | 'setup_running'
  | 'setup_failed'
  | 'agent_running'
  | 'agent_failed'
  | 'agent_succeeded'
  | 'cancelled'
  | 'interrupted'

type RemoteAgentJobSummary = {
  jobId: Id<'agentJobs'>
  targetWorkerId: string
  targetRepoId: string
  promptText: string
  status: RemoteAgentJobStatus
  branchName?: string
  runId?: string
  codexThreadId?: string
  pendingHumanInputRequest?: {
    requestId: Id<'agentJobHumanInputRequests'>
    promptText: string
    createdAt: number
  }
  createdAt: number
  updatedAt: number
  claimedAt?: number
  completedAt?: number
  errorMessage?: string
  resultSummary?: string
}

function joinClassNames(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(' ')
}

function resolveWorkspaceDrafts(
  drafts: WorkspaceDraft[],
  count: number
): { ok: true; workspaces: WorkspaceRequestInput[] } | { ok: false; errorMessage: string } {
  const firstBranchName = drafts[0]?.branchName.trim() ?? ''

  if (!firstBranchName) {
    return { ok: false, errorMessage: 'Branch name is required.' }
  }

  const branchNames = new Set<string>()
  const workspaces = drafts.slice(0, count).map((draft, index) => {
    const branchName = draft.branchName.trim() || `${firstBranchName}-${index + 1}`

    return {
      branchName,
      scriptArgs: draft.scriptArgs
    }
  })

  for (const workspace of workspaces) {
    if (branchNames.has(workspace.branchName)) {
      return { ok: false, errorMessage: 'Branch names must be unique.' }
    }

    branchNames.add(workspace.branchName)
  }

  return { ok: true, workspaces }
}

function formatLastSeen(lastSeenAt: number | null): string {
  if (!lastSeenAt) {
    return 'No heartbeat'
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(lastSeenAt))
}

function formatFullTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return 'Not synced'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

function getReadinessLabel(status: DesktopRepoSummary['readinessStatus']): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'dirty':
      return 'Dirty'
    case 'missing_script':
      return 'Missing script'
    case 'missing_repo':
      return 'Missing repo'
    case 'invalid':
      return 'Invalid'
    case 'error':
      return 'Error'
  }
}

function isRunnableRepo(repo: DesktopRepoSummary | null): boolean {
  return Boolean(
    repo?.isValid || repo?.readinessStatus === 'dirty' || repo?.readinessStatus === 'missing_script'
  )
}

function getWorkerDisplayStatus(worker: DesktopWorkerSummary, now: number): DisplayWorkerStatus {
  if (
    worker.status !== 'offline' &&
    worker.lastSeenAt &&
    now - worker.lastSeenAt <= WORKER_ONLINE_THRESHOLD_MS
  ) {
    return worker.status === 'busy' ? 'Busy' : 'Online'
  }

  return 'Offline'
}

function getRepoKey(repo: DesktopRepoSummary): string {
  return `${repo.workerId}:${repo.localRepoId}`
}

function getBranchLabel(repo: DesktopRepoSummary): string {
  return (
    repo.workspaceBranchName || (repo.sourceLocalRepoId ? repo.name : repo.currentBranch || 'main')
  )
}

function isActiveAgentJobStatus(status: RemoteAgentJobStatus): boolean {
  return (
    status === 'queued' ||
    status === 'claimed' ||
    status === 'setup_running' ||
    status === 'agent_running' ||
    status === 'interrupted'
  )
}

function getAgentJobStatusLabel(status: RemoteAgentJobStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'claimed':
      return 'Claimed'
    case 'setup_running':
      return 'Setting up'
    case 'setup_failed':
      return 'Setup failed'
    case 'agent_running':
      return 'Running'
    case 'agent_failed':
      return 'Failed'
    case 'agent_succeeded':
      return 'Succeeded'
    case 'cancelled':
      return 'Cancelled'
    case 'interrupted':
      return 'Interrupted'
  }
}

function getAgentJobNotice(job: RemoteAgentJobSummary): string {
  switch (job.status) {
    case 'agent_running':
      return 'Agent is running on the desktop app.'
    case 'claimed':
      return 'Desktop app claimed the agent job.'
    case 'setup_running':
      return 'Desktop app is preparing the local environment.'
    case 'queued':
      return 'Agent job is queued for the desktop app.'
    case 'interrupted':
      return 'Agent is waiting for human input.'
    default:
      return ''
  }
}

function buildRepoGroups(repos: DesktopRepoSummary[]): RepoGroup[] {
  const reposById = new Map(repos.map((repo) => [repo.localRepoId, repo]))
  const groups = new Map<string, RepoGroup>()

  for (const repo of repos) {
    const root = repo.sourceLocalRepoId ? (reposById.get(repo.sourceLocalRepoId) ?? repo) : repo
    const groupId = root.localRepoId
    const existingGroup = groups.get(groupId)

    if (existingGroup) {
      existingGroup.branches.push(repo)
      continue
    }

    groups.set(groupId, {
      id: groupId,
      name: root.name,
      root,
      branches: [root === repo ? repo : root, ...(root === repo ? [] : [repo])]
    })
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    branches: Array.from(
      new Map(group.branches.map((repo) => [repo.localRepoId, repo])).values()
    ).sort((first, second) => {
      if (first.localRepoId === group.root.localRepoId) {
        return -1
      }

      if (second.localRepoId === group.root.localRepoId) {
        return 1
      }

      return getBranchLabel(first).localeCompare(getBranchLabel(second))
    })
  }))
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function MissingAuthKey(): React.JSX.Element {
  return (
    <SetupRequired
      eyebrow="Auth setup required"
      title="Add your web Clerk public key"
      text={
        <>
          Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> in <code>apps/web/.env.local</code>,
          then restart the Next dev server.
        </>
      }
    />
  )
}

function MissingConvexUrl(): React.JSX.Element {
  return (
    <SetupRequired
      eyebrow="Backend setup required"
      title="Add the shared Convex URL"
      text={
        <>
          Set <code>NEXT_PUBLIC_CONVEX_URL</code> so the web dashboard can read desktop worker and
          repository state.
        </>
      }
    />
  )
}

function SetupRequired({
  eyebrow,
  text,
  title
}: {
  eyebrow: string
  text: React.ReactNode
  title: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-10">
      <section className="w-full max-w-xl rounded-[28px] border border-amber-300/20 bg-amber-100/10 p-8 shadow-2xl backdrop-blur-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-200/80">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-200/82">{text}</p>
      </section>
    </div>
  )
}

function ConnectedStatus(): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()
  const viewer = useQuery(api.auth.viewer, isSignedIn ? {} : 'skip')
  const workers = useQuery(api.workers.listDesktopWorkers, isSignedIn ? {} : 'skip')
  const repos = useQuery(api.repos.listDesktopRepos, isSignedIn ? {} : 'skip')
  const [now, setNow] = useState(() => Date.now())
  const [requestedWorkerId, setRequestedWorkerId] = useState<string | null>(null)
  const [requestedRepoKey, setRequestedRepoKey] = useState<string | null>(null)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now())
    }, 30_000)

    return () => window.clearInterval(intervalId)
  }, [])

  const selectedWorkerId = useMemo(() => {
    if (!workers || workers.length === 0) {
      return null
    }

    if (requestedWorkerId && workers.some((worker) => worker.workerId === requestedWorkerId)) {
      return requestedWorkerId
    }

    return workers[0].workerId
  }, [requestedWorkerId, workers])

  const selectedRepoKey = useMemo(() => {
    if (!repos || repos.length === 0 || !selectedWorkerId) {
      return null
    }

    const workerRepos = repos.filter((repo) => repo.workerId === selectedWorkerId)

    if (workerRepos.length === 0) {
      return null
    }

    if (requestedRepoKey && workerRepos.some((repo) => getRepoKey(repo) === requestedRepoKey)) {
      return requestedRepoKey
    }

    return getRepoKey(workerRepos[0])
  }, [repos, requestedRepoKey, selectedWorkerId])

  function handleSelectWorker(workerId: string): void {
    setRequestedWorkerId(workerId)
    setRequestedRepoKey(null)
  }

  function handleSelectRepo(repoKey: string): void {
    setRequestedRepoKey(repoKey)
  }

  if (!isLoaded) {
    return <CenteredStatus message="Loading authentication..." />
  }

  return (
    <>
      <SignedOut>
        <AuthPrompt />
      </SignedOut>

      <SignedIn>
        <RemoteDashboard
          now={now}
          repos={repos ?? null}
          selectedRepoKey={selectedRepoKey}
          selectedWorkerId={selectedWorkerId}
          setSelectedRepoKey={handleSelectRepo}
          setSelectedWorkerId={handleSelectWorker}
          viewerName={viewer?.name ?? null}
          workers={workers ?? null}
        />
      </SignedIn>
    </>
  )
}

function AuthPrompt(): React.JSX.Element {
  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-6xl items-center justify-center px-6 py-10">
      <div className="grid w-full overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/70 shadow-[0_32px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col justify-between border-white/8 p-8 lg:border-r lg:p-12">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg border border-blue-400/20 bg-blue-500/18 text-blue-100 shadow-[0_10px_30px_rgba(37,99,235,0.18)]">
                <Workflow className="size-5" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-white">Deskbinder</h1>
            </div>
            <h2 className="mt-8 max-w-lg text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Manage your local desk from the web.
            </h2>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300/78">
              Sign in with the same account used by the desktop app to see active workers,
              repositories, branches, and readiness state.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <FeatureCard
              eyebrow="Workers"
              title="Desktop-aware"
              text="The web dashboard follows worker heartbeats from the shared Convex backend."
            />
            <FeatureCard
              eyebrow="Repos"
              title="Environment view"
              text="Repository readiness mirrors the local state reported by the Electron app."
            />
          </div>
        </div>

        <div className="flex items-center justify-center border-t border-white/8 p-8 lg:border-t-0 lg:p-10">
          <div className="w-full max-w-sm rounded-[28px] border border-white/8 bg-white/5 p-6 text-center backdrop-blur">
            <Monitor className="mx-auto size-10 text-blue-300" />
            <h3 className="mt-5 text-2xl font-semibold tracking-tight text-white">
              Open your dashboard
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300/76">
              Your browser session connects to the same backend as the desktop shell.
            </p>
            <SignInButton mode="modal">
              <button
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                type="button"
              >
                Sign in
              </button>
            </SignInButton>
          </div>
        </div>
      </div>
    </section>
  )
}

function RemoteDashboard({
  now,
  repos,
  selectedRepoKey,
  selectedWorkerId,
  setSelectedRepoKey,
  setSelectedWorkerId,
  viewerName,
  workers
}: {
  now: number
  repos: DesktopRepoSummary[] | null
  selectedRepoKey: string | null
  selectedWorkerId: string | null
  setSelectedRepoKey: (repoKey: string) => void
  setSelectedWorkerId: (workerId: string) => void
  viewerName: string | null
  workers: DesktopWorkerSummary[] | null
}): React.JSX.Element {
  const createBranchRequests = useMutation(api.branchRequests.createBranchRequests)
  const createAgentJob = useMutation(api.agentJobs.createAgentJob)
  const answerHumanInputRequest = useMutation(api.agentJobs.answerHumanInputRequest)
  const [repoForBranchRequest, setRepoForBranchRequest] = useState<DesktopRepoSummary | null>(null)
  const [isRequestingBranch, setIsRequestingBranch] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [isSubmittingAgentJob, setIsSubmittingAgentJob] = useState(false)
  const [remoteNotice, setRemoteNotice] = useState<RemoteNotice | null>(null)
  const [isNavOpen, setIsNavOpen] = useState(false)
  const closeNav = useCallback(() => setIsNavOpen(false), [])
  const selectedWorker = useMemo(
    () => workers?.find((worker) => worker.workerId === selectedWorkerId) ?? null,
    [selectedWorkerId, workers]
  )
  const workerRepos = useMemo(
    () => repos?.filter((repo) => repo.workerId === selectedWorkerId) ?? [],
    [repos, selectedWorkerId]
  )
  const selectedRepo = useMemo(
    () => workerRepos.find((repo) => getRepoKey(repo) === selectedRepoKey) ?? null,
    [selectedRepoKey, workerRepos]
  )
  const agentJobs = useQuery(
    api.agentJobs.listRecentAgentJobs,
    selectedRepo
      ? {
          targetWorkerId: selectedRepo.workerId,
          targetRepoId: selectedRepo.localRepoId
        }
      : 'skip'
  )
  const activeAgentJob = useMemo(
    () => agentJobs?.find((job) => isActiveAgentJobStatus(job.status)) ?? null,
    [agentJobs]
  )
  const selectedWorkerStatus = selectedWorker ? getWorkerDisplayStatus(selectedWorker, now) : null
  const isLoading = !workers || !repos
  const canSubmitAgentJob =
    Boolean(selectedRepo) &&
    agentJobs !== undefined &&
    selectedWorkerStatus !== 'Offline' &&
    isRunnableRepo(selectedRepo) &&
    !activeAgentJob &&
    !isSubmittingAgentJob

  async function handleCreateBranchRequest(workspaces: WorkspaceRequestInput[]): Promise<void> {
    const sourceRepo = repoForBranchRequest

    if (!sourceRepo) {
      return
    }

    setIsRequestingBranch(true)

    try {
      await createBranchRequests({
        targetWorkerId: sourceRepo.workerId,
        sourceLocalRepoId: sourceRepo.localRepoId,
        requests: workspaces
      })
      setRemoteNotice({
        tone: 'success',
        message: `Queued ${workspaces.length} workspace requests for ${sourceRepo.name}.`
      })
      setRepoForBranchRequest(null)
    } catch (error) {
      setRemoteNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to queue branch request.'
      })
    } finally {
      setIsRequestingBranch(false)
    }
  }

  async function handleSubmitPrompt(): Promise<void> {
    const targetRepo = selectedRepo
    const promptText = draftPrompt.trim()

    if (!targetRepo || !promptText || !canSubmitAgentJob) {
      return
    }

    setIsSubmittingAgentJob(true)

    try {
      await createAgentJob({
        targetWorkerId: targetRepo.workerId,
        targetRepoId: targetRepo.localRepoId,
        promptText
      })
      setDraftPrompt('')
      setRemoteNotice({
        tone: 'success',
        message: 'Agent job queued for the desktop app.'
      })
    } catch (error) {
      setRemoteNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to queue agent job.'
      })
    } finally {
      setIsSubmittingAgentJob(false)
    }
  }

  async function handleAnswerHumanInputRequest(
    requestId: Id<'agentJobHumanInputRequests'>,
    responseText: string
  ): Promise<void> {
    try {
      await answerHumanInputRequest({
        requestId,
        responseText
      })
      setRemoteNotice({
        tone: 'success',
        message: 'Human input sent to the desktop app.'
      })
    } catch (error) {
      setRemoteNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to send human input.'
      })
    }
  }

  return (
    <>
      <section className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-[#080d14]">
        <RemoteSidebar
          isOpen={isNavOpen}
          now={now}
          onClose={closeNav}
          onNewBranch={(repo) => {
            setRepoForBranchRequest(repo)
            setIsNavOpen(false)
          }}
          repos={repos}
          selectedRepoKey={selectedRepoKey}
          selectedWorkerId={selectedWorkerId}
          setSelectedRepoKey={(repoKey) => {
            setSelectedRepoKey(repoKey)
            setIsNavOpen(false)
          }}
          setSelectedWorkerId={setSelectedWorkerId}
          viewerName={viewerName}
          workers={workers}
        />

        <section className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-[#080d14]/94 backdrop-blur-2xl">
          <WorkspaceHeader
            isLoading={isLoading}
            onOpenNav={() => setIsNavOpen(true)}
            selectedRepo={selectedRepo}
            selectedWorker={selectedWorker}
            selectedWorkerStatus={selectedWorkerStatus}
          />

          {!isLoading && workers.length === 0 ? (
            <Notice
              tone="warning"
              message="Open the desktop app with this account to register a worker."
            />
          ) : null}

          {selectedWorker && selectedWorkerStatus === 'Offline' ? (
            <Notice
              tone="warning"
              message="This desktop worker is offline. Start the Electron app before issuing local environment commands."
            />
          ) : null}

          {remoteNotice ? <Notice tone={remoteNotice.tone} message={remoteNotice.message} /> : null}

          {activeAgentJob ? (
            <Notice tone="success" message={getAgentJobNotice(activeAgentJob)} />
          ) : null}

          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {isLoading ? (
              <CenteredStatus compact message="Loading desktop state..." />
            ) : selectedRepo && selectedWorker ? (
              <WorkspacePanel
                agentJobs={agentJobs ?? []}
                onAnswerHumanInputRequest={(requestId, responseText) =>
                  void handleAnswerHumanInputRequest(requestId, responseText)
                }
              />
            ) : (
              <EmptyWorkspaceState hasWorkers={Boolean(workers.length)} />
            )}
          </main>

          <PromptComposer
            disabled={!canSubmitAgentJob}
            isSubmitting={isSubmittingAgentJob}
            onSubmit={() => void handleSubmitPrompt()}
            prompt={draftPrompt}
            setPrompt={setDraftPrompt}
          />
        </section>
      </section>

      <BranchRequestDialog
        isSubmitting={isRequestingBranch}
        onOpenChange={(open) => {
          if (!open) {
            setRepoForBranchRequest(null)
          }
        }}
        onSubmit={(workspaces) => void handleCreateBranchRequest(workspaces)}
        open={repoForBranchRequest !== null}
        repo={repoForBranchRequest}
      />
    </>
  )
}

function RemoteSidebar({
  isOpen,
  now,
  onClose,
  onNewBranch,
  repos,
  selectedRepoKey,
  selectedWorkerId,
  setSelectedRepoKey,
  setSelectedWorkerId,
  viewerName,
  workers
}: {
  isOpen: boolean
  now: number
  onClose: () => void
  onNewBranch: (repo: DesktopRepoSummary) => void
  repos: DesktopRepoSummary[] | null
  selectedRepoKey: string | null
  selectedWorkerId: string | null
  setSelectedRepoKey: (repoKey: string) => void
  setSelectedWorkerId: (workerId: string) => void
  viewerName: string | null
  workers: DesktopWorkerSummary[] | null
}): React.JSX.Element {
  const workerRepos = repos?.filter((repo) => repo.workerId === selectedWorkerId) ?? []
  const repoGroups = buildRepoGroups(workerRepos)
  const canRequestBranch = Boolean(selectedWorkerId)
  const [isWorkerDialogOpen, setIsWorkerDialogOpen] = useState(false)
  const selectedWorker = useMemo(
    () => workers?.find((worker) => worker.workerId === selectedWorkerId) ?? null,
    [selectedWorkerId, workers]
  )
  const selectedWorkerStatus = selectedWorker ? getWorkerDisplayStatus(selectedWorker, now) : null
  const workerRepoCounts = useMemo(() => {
    const counts = new Map<string, number>()

    for (const repo of repos ?? []) {
      counts.set(repo.workerId, (counts.get(repo.workerId) ?? 0) + 1)
    }

    return counts
  }, [repos])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  return (
    <>
      <button
        aria-label="Close navigation"
        aria-hidden={!isOpen}
        className={joinClassNames(
          'fixed inset-0 z-30 bg-black/56 backdrop-blur-sm transition-opacity',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
        tabIndex={isOpen ? 0 : -1}
        type="button"
      />

      <aside
        aria-label="Deskbinder navigation"
        aria-hidden={!isOpen}
        className={joinClassNames(
          'fixed inset-y-0 left-0 z-40 flex w-[min(22.5rem,calc(100vw-1.5rem))] min-w-0 flex-col border-r border-white/10 bg-[#0a0f17]/98 shadow-[24px_0_80px_rgba(0,0,0,0.45)] transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        inert={!isOpen ? true : undefined}
      >
        <div className="border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg border border-blue-400/20 bg-blue-500/18 text-blue-100 shadow-[0_10px_30px_rgba(37,99,235,0.18)]">
              <Workflow className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight text-white">
                  Deskbinder
                </h1>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400">
                  web
                </span>
              </div>
            </div>
            <button
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-slate-300 transition-colors hover:bg-white/[0.075] hover:text-white"
              onClick={onClose}
              type="button"
            >
              <X className="size-5" />
              <span className="sr-only">Close navigation</span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-6 pb-4">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3 px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Repositories
                </p>
                <span className="text-xs text-slate-500">{repos ? repoGroups.length : '-'}</span>
              </div>

              {!repos ? (
                <SidebarLoadingRows />
              ) : repoGroups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 bg-white/[0.025] px-3 py-3 text-sm text-slate-400">
                  No synced repositories.
                </p>
              ) : (
                <div className="space-y-5">
                  {repoGroups.map((group) => (
                    <section key={group.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <button
                          className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold text-slate-100"
                          onClick={() => setSelectedRepoKey(getRepoKey(group.root))}
                          type="button"
                        >
                          <ChevronDown className="size-4 shrink-0 text-slate-500" />
                          <Folder className="size-5 shrink-0 text-slate-300" />
                          <span className="truncate">{group.name}</span>
                        </button>

                        <button
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.035] px-2 text-xs text-slate-300 hover:bg-white/[0.075] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                          disabled={!canRequestBranch}
                          onClick={() => onNewBranch(group.root)}
                          type="button"
                        >
                          <Plus className="size-3.5" />
                          New Branch
                        </button>
                      </div>

                      <div className="ml-[30px] border-l border-white/10 pl-0">
                        {group.branches.map((repo) => (
                          <RepoButton
                            key={getRepoKey(repo)}
                            onSelect={setSelectedRepoKey}
                            repo={repo}
                            selected={getRepoKey(repo) === selectedRepoKey}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3 px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Desktop Worker
                </p>
                <span className="text-xs text-slate-500">{workers ? workers.length : '-'}</span>
              </div>

              {!workers ? (
                <div className="h-16 animate-pulse rounded-lg border border-white/8 bg-white/[0.025]" />
              ) : workers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 bg-white/[0.025] px-3 py-3 text-sm text-slate-400">
                  No workers registered.
                </p>
              ) : (
                <SelectedWorkerControl
                  onManage={() => setIsWorkerDialogOpen(true)}
                  repoCount={
                    selectedWorker ? (workerRepoCounts.get(selectedWorker.workerId) ?? 0) : 0
                  }
                  selectedWorker={selectedWorker}
                  selectedWorkerStatus={selectedWorkerStatus}
                />
              )}
            </section>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-medium text-slate-200">
                {getInitials(viewerName ?? 'Deskbinder User') || 'DB'}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{viewerName ?? 'Account'}</p>
                <p className="truncate text-xs text-slate-400">Web dashboard</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <UserButton />
              <SignOutButton>
                <button
                  className="inline-flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/8 hover:text-white"
                  type="button"
                >
                  <LogOut className="size-4" />
                  <span className="sr-only">Sign out</span>
                </button>
              </SignOutButton>
            </div>
          </div>
        </div>
      </aside>

      {isWorkerDialogOpen ? (
        <WorkerManagementDialog
          now={now}
          onOpenChange={setIsWorkerDialogOpen}
          onSelectWorker={setSelectedWorkerId}
          repoCounts={workerRepoCounts}
          selectedWorkerId={selectedWorkerId}
          workers={workers ?? []}
        />
      ) : null}
    </>
  )
}

function SelectedWorkerControl({
  onManage,
  repoCount,
  selectedWorker,
  selectedWorkerStatus
}: {
  onManage: () => void
  repoCount: number
  selectedWorker: DesktopWorkerSummary | null
  selectedWorkerStatus: DisplayWorkerStatus | null
}): React.JSX.Element {
  return (
    <button
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.025] px-3 py-3 text-left text-slate-300 transition-colors hover:bg-white/[0.055] hover:text-white"
      onClick={onManage}
      type="button"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-300">
          <Monitor className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-100">
              {selectedWorker?.name ?? 'Choose worker'}
            </p>
            {selectedWorkerStatus ? <StatusDot status={selectedWorkerStatus} /> : null}
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {selectedWorker
              ? `${selectedWorkerStatus ?? 'Offline'} - ${repoCount} repos`
              : 'No worker selected'}
          </p>
        </div>
      </div>
      <Settings className="size-4 shrink-0 text-slate-400" />
      <span className="sr-only">Manage desktop workers</span>
    </button>
  )
}

function WorkerManagementDialog({
  now,
  onOpenChange,
  onSelectWorker,
  repoCounts,
  selectedWorkerId,
  workers
}: {
  now: number
  onOpenChange: (open: boolean) => void
  onSelectWorker: (workerId: string) => void
  repoCounts: Map<string, number>
  selectedWorkerId: string | null
  workers: DesktopWorkerSummary[]
}): React.JSX.Element | null {
  const updateWorkerName = useMutation(api.workers.updateDesktopWorkerName)
  const hideWorker = useMutation(api.workers.hideDesktopWorker)
  const [draftNames, setDraftNames] = useState<Record<string, string>>({})
  const [busyWorkerId, setBusyWorkerId] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busyWorkerId) {
        onOpenChange(false)
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [busyWorkerId, onOpenChange])

  async function handleRename(worker: DesktopWorkerSummary): Promise<void> {
    const name = draftNames[worker.workerId]?.trim() ?? ''

    if (!name || name === worker.name) {
      return
    }

    setBusyWorkerId(worker.workerId)
    setDialogError(null)

    try {
      await updateWorkerName({
        workerId: worker.workerId,
        name
      })
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Unable to rename worker.')
    } finally {
      setBusyWorkerId(null)
    }
  }

  async function handleHide(worker: DesktopWorkerSummary): Promise<void> {
    setBusyWorkerId(worker.workerId)
    setDialogError(null)

    try {
      await hideWorker({
        workerId: worker.workerId
      })
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Unable to hide worker.')
    } finally {
      setBusyWorkerId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/62 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
      <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950/96 text-slate-100 shadow-2xl sm:max-h-[calc(100vh-3rem)]">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">Desktop workers</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300/78">
              Choose the worker this dashboard controls, or give a worker a local nickname.
            </p>
          </div>
          <button
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
            disabled={Boolean(busyWorkerId)}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            <X className="size-5" />
            <span className="sr-only">Close worker management</span>
          </button>
        </div>

        <div className="max-h-[min(34rem,calc(100dvh-10rem))] space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          {dialogError ? (
            <p className="rounded-lg border border-rose-300/18 bg-rose-300/8 px-3 py-2 text-sm text-rose-100">
              {dialogError}
            </p>
          ) : null}

          {workers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 bg-white/[0.025] px-3 py-3 text-sm text-slate-400">
              No workers registered.
            </p>
          ) : (
            workers.map((worker) => {
              const status = getWorkerDisplayStatus(worker, now)
              const isSelected = worker.workerId === selectedWorkerId
              const draftName = draftNames[worker.workerId] ?? worker.name
              const isBusy = busyWorkerId === worker.workerId
              const canRename = draftName.trim() !== '' && draftName.trim() !== worker.name

              return (
                <article
                  className={joinClassNames(
                    'rounded-lg border p-3',
                    isSelected
                      ? 'border-blue-300/24 bg-blue-500/10'
                      : 'border-white/10 bg-white/[0.025]'
                  )}
                  key={worker.workerId}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <button
                      className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isBusy}
                      onClick={() => onSelectWorker(worker.workerId)}
                      type="button"
                    >
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-300">
                        <Monitor className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-slate-100">
                            {worker.name}
                          </span>
                          <StatusPill status={status} />
                        </span>
                        <span className="mt-1 block truncate text-xs text-slate-500">
                          Worker {worker.workerId.slice(0, 8)} -{' '}
                          {repoCounts.get(worker.workerId) ?? 0} repos - heartbeat{' '}
                          {formatLastSeen(worker.lastSeenAt)}
                        </span>
                      </span>
                    </button>

                    {isSelected ? (
                      <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-blue-300/20 bg-blue-300/10 px-2.5 text-xs font-medium text-blue-100">
                        Selected
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Worker nickname</span>
                      <input
                        className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-300/60 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={Boolean(busyWorkerId)}
                        maxLength={80}
                        onChange={(event) =>
                          setDraftNames((currentDraftNames) => ({
                            ...currentDraftNames,
                            [worker.workerId]: event.target.value
                          }))
                        }
                        placeholder="Worker nickname"
                        value={draftName}
                      />
                    </label>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-sm text-slate-200 hover:bg-white/[0.075] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={Boolean(busyWorkerId) || !canRename}
                      onClick={() => void handleRename(worker)}
                      type="button"
                    >
                      {isBusy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Pencil className="size-4" />
                      )}
                      Rename
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-300/16 bg-rose-300/8 px-3 text-sm text-rose-100 hover:bg-rose-300/14 disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={Boolean(busyWorkerId)}
                      onClick={() => void handleHide(worker)}
                      type="button"
                    >
                      {isBusy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Hide
                    </button>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

function RepoButton({
  onSelect,
  repo,
  selected
}: {
  onSelect: (repoKey: string) => void
  repo: DesktopRepoSummary
  selected: boolean
}): React.JSX.Element {
  return (
    <div
      className={joinClassNames(
        'group relative flex h-9 items-center gap-2 rounded-md border border-transparent transition-colors',
        selected ? 'bg-white/[0.065] text-blue-300' : 'text-slate-400 hover:bg-white/[0.04]'
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 px-4 text-left text-sm"
        onClick={() => onSelect(getRepoKey(repo))}
        type="button"
      >
        <GitBranch className="size-4 shrink-0" />
        <span className="truncate">{getBranchLabel(repo)}</span>
      </button>
      <span
        className={joinClassNames(
          'mr-2 size-2 rounded-full',
          repo.isValid ? 'bg-emerald-400' : 'bg-amber-300'
        )}
      />
    </div>
  )
}

function BranchRequestDialog({
  isSubmitting,
  onOpenChange,
  onSubmit,
  open,
  repo
}: {
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (workspaces: WorkspaceRequestInput[]) => void
  open: boolean
  repo: DesktopRepoSummary | null
}): React.JSX.Element | null {
  if (!open || !repo) {
    return null
  }

  return (
    <BranchRequestDialogContent
      isSubmitting={isSubmitting}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      repo={repo}
    />
  )
}

function BranchRequestDialogContent({
  isSubmitting,
  onOpenChange,
  onSubmit,
  repo
}: {
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (workspaces: WorkspaceRequestInput[]) => void
  repo: DesktopRepoSummary
}): React.JSX.Element {
  const [workspaceCount, setWorkspaceCount] = useState(1)
  const [workspaceDrafts, setWorkspaceDrafts] = useState<WorkspaceDraft[]>(() =>
    WORKSPACE_COUNTS.map(() => ({
      branchName: '',
      scriptArgs: repo.defaultScriptArgs ?? ''
    }))
  )
  const [formError, setFormError] = useState<string | null>(null)

  function updateWorkspaceDraft(index: number, patch: Partial<WorkspaceDraft>): void {
    setWorkspaceDrafts((currentDrafts) =>
      currentDrafts.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft
      )
    )
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const result = resolveWorkspaceDrafts(workspaceDrafts, workspaceCount)

    if (!result.ok) {
      setFormError(result.errorMessage)
      return
    }

    setFormError(null)
    onSubmit(result.workspaces)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/62 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
      <form
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/96 text-slate-100 shadow-2xl sm:max-h-[calc(100vh-3rem)]"
        onSubmit={handleSubmit}
      >
        <div className="border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
          <h2 className="text-lg font-semibold text-white">New branch</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300/78">
            Queue workspace requests for the desktop app to run against {repo.name}.
          </p>
        </div>

        <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-5">
          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Workspace Count
            </span>
            <select
              className="h-11 w-32 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-blue-300/60 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              onChange={(event) => setWorkspaceCount(Number(event.target.value))}
              value={workspaceCount}
            >
              {WORKSPACE_COUNTS.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-3">
            {workspaceDrafts.slice(0, workspaceCount).map((draft, index) => (
              <div
                className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3 md:grid-cols-2"
                key={index}
              >
                <label className="block space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
                    Branch {index + 1}
                  </span>
                  <input
                    autoFocus={index === 0}
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-300/60 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSubmitting}
                    onChange={(event) => {
                      setFormError(null)
                      updateWorkspaceDraft(index, { branchName: event.target.value })
                    }}
                    placeholder={index === 0 ? 'agent/test' : 'auto-generated'}
                    value={draft.branchName}
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
                    Script Args
                  </span>
                  <input
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-300/60 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSubmitting}
                    onChange={(event) => {
                      setFormError(null)
                      updateWorkspaceDraft(index, { scriptArgs: event.target.value })
                    }}
                    placeholder="--port 3001 --env dev"
                    value={draft.scriptArgs}
                  />
                </label>
              </div>
            ))}
          </div>

          {formError ? <p className="text-sm text-red-300">{formError}</p> : null}

          <div className="rounded-lg border border-white/8 bg-white/[0.025] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Desktop Worker
            </p>
            <p className="mt-2 truncate text-sm text-slate-200">{repo.workerId}</p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/10 bg-white/[0.03] px-4 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-6">
          <button
            className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm text-slate-200 hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-55 sm:h-10"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-55 sm:h-10"
            disabled={isSubmitting || !workspaceDrafts[0]?.branchName.trim()}
            type="submit"
          >
            {isSubmitting
              ? 'Queueing...'
              : workspaceCount === 1
                ? 'Queue Branch'
                : 'Queue Branches'}
          </button>
        </div>
      </form>
    </div>
  )
}

function WorkspaceHeader({
  isLoading,
  onOpenNav,
  selectedRepo,
  selectedWorker,
  selectedWorkerStatus
}: {
  isLoading: boolean
  onOpenNav: () => void
  selectedRepo: DesktopRepoSummary | null
  selectedWorker: DesktopWorkerSummary | null
  selectedWorkerStatus: DisplayWorkerStatus | null
}): React.JSX.Element {
  const connected = selectedWorkerStatus === 'Online' || selectedWorkerStatus === 'Busy'
  const repoReady = selectedRepo ? isRunnableRepo(selectedRepo) : false
  const headerStatusDetails =
    selectedRepo && selectedWorker ? (
      <div className="flex shrink-0 items-center gap-1.5" aria-label="Repository and worker status">
        <HeaderStatusIcon
          detail={`${selectedWorker.name} - ${selectedWorkerStatus ?? 'Offline'} - heartbeat ${formatLastSeen(selectedWorker.lastSeenAt)}`}
          icon={<Monitor className="size-4" />}
          label="Worker"
          tone={connected ? (selectedWorkerStatus === 'Busy' ? 'busy' : 'good') : 'muted'}
        />
        <HeaderStatusIcon
          detail={`${selectedRepo.readinessMessage ?? (repoReady ? 'Ready for agent work' : 'Needs attention before running')} - synced ${formatFullTimestamp(selectedRepo.lastSeenAt)} - ${selectedRepo.agentExecutable} via ${selectedRepo.workspaceScriptPath}`}
          icon={
            repoReady ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />
          }
          label={`Repository ${getReadinessLabel(selectedRepo.readinessStatus)}`}
          tone={repoReady ? 'good' : 'warn'}
        />
      </div>
    ) : null

  return (
    <header className="flex min-h-[68px] shrink-0 items-center gap-3 border-b border-white/10 px-3 py-3 sm:px-5">
      <button
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
        onClick={onOpenNav}
        type="button"
      >
        <Menu className="size-5" />
        <span className="sr-only">Open navigation</span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-slate-100 sm:text-lg">
            {selectedRepo ? selectedRepo.name : isLoading ? 'Deskbinder' : 'No repository'}
          </h2>
          {selectedRepo ? (
            <>
              <span className="shrink-0 text-slate-500">/</span>
              <span className="min-w-0 truncate text-base font-semibold tracking-tight text-blue-300 sm:text-lg">
                {getBranchLabel(selectedRepo)}
              </span>
            </>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs text-slate-500">
          {selectedWorker
            ? `${selectedWorker.name} - ${selectedWorkerStatus ?? 'Offline'}`
            : 'Desktop worker'}
        </p>
      </div>

      {headerStatusDetails}
    </header>
  )
}

function HeaderStatusIcon({
  detail,
  icon,
  label,
  tone = 'muted'
}: {
  detail: string
  icon: React.ReactNode
  label: string
  tone?: 'busy' | 'good' | 'muted' | 'warn'
}): React.JSX.Element {
  const title = `${label}: ${detail}`

  return (
    <span className="group relative inline-flex">
      <span
        aria-label={title}
        className={joinClassNames(
          'inline-flex size-8 items-center justify-center rounded-md border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-300/40',
          tone === 'good'
            ? 'border-emerald-300/20 bg-emerald-300/8 text-emerald-300'
            : tone === 'busy'
              ? 'border-blue-300/20 bg-blue-300/8 text-blue-300'
              : tone === 'warn'
                ? 'border-amber-300/20 bg-amber-300/8 text-amber-300'
                : 'border-white/10 bg-white/[0.035] text-slate-400'
        )}
        role="img"
        tabIndex={0}
      >
        {icon}
      </span>
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+0.5rem)] z-30 hidden w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-left shadow-[0_18px_60px_rgba(0,0,0,0.45)] group-hover:block group-focus-within:block">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </span>
        <span className="mt-1 block break-words text-xs leading-5 text-slate-200">{detail}</span>
      </span>
    </span>
  )
}

function WorkspacePanel({
  agentJobs,
  onAnswerHumanInputRequest
}: {
  agentJobs: RemoteAgentJobSummary[]
  onAnswerHumanInputRequest: (
    requestId: Id<'agentJobHumanInputRequests'>,
    responseText: string
  ) => void
}): React.JSX.Element {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-3 py-4 sm:px-5 sm:py-6">
      <AgentJobList jobs={agentJobs} onAnswerHumanInputRequest={onAnswerHumanInputRequest} />
    </div>
  )
}

function AgentJobList({
  jobs,
  onAnswerHumanInputRequest
}: {
  jobs: RemoteAgentJobSummary[]
  onAnswerHumanInputRequest: (
    requestId: Id<'agentJobHumanInputRequests'>,
    responseText: string
  ) => void
}): React.JSX.Element {
  const visibleJobs = [...jobs]
    .sort((first, second) => first.createdAt - second.createdAt)
    .slice(-8)

  return (
    <section className="flex min-h-full flex-col gap-5" aria-label="Conversation">
      {jobs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
          Start a conversation with the agent from this repository.
        </div>
      ) : (
        visibleJobs.map((job) => (
          <AgentJobRow
            key={job.jobId}
            job={job}
            onAnswerHumanInputRequest={onAnswerHumanInputRequest}
          />
        ))
      )}
    </section>
  )
}

function AgentJobRow({
  job,
  onAnswerHumanInputRequest
}: {
  job: RemoteAgentJobSummary
  onAnswerHumanInputRequest: (
    requestId: Id<'agentJobHumanInputRequests'>,
    responseText: string
  ) => void
}): React.JSX.Element {
  const isActive = isActiveAgentJobStatus(job.status)
  const isSuccess = job.status === 'agent_succeeded'
  const [humanInputResponse, setHumanInputResponse] = useState('')
  const statusClassName = isSuccess
    ? 'text-emerald-300'
    : isActive && job.status !== 'interrupted'
      ? 'text-blue-300'
      : job.status === 'interrupted'
        ? 'text-amber-300'
        : 'text-rose-300'
  const pendingRequest = job.pendingHumanInputRequest

  return (
    <article className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-[15px] leading-6 text-white shadow-[0_16px_50px_rgba(37,99,235,0.22)] sm:max-w-[76%]">
          <p className="whitespace-pre-wrap break-words">{job.promptText}</p>
          <p className="mt-2 text-right text-[11px] text-blue-100/75">
            {job.branchName ? `${job.branchName} - ` : ''}
            {formatFullTimestamp(job.createdAt)}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-slate-300">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 max-w-[86%] rounded-2xl rounded-bl-md border border-white/10 bg-[#0c121b]/92 px-4 py-3 text-[15px] leading-6 text-slate-200 shadow-[0_16px_50px_rgba(0,0,0,0.18)] sm:max-w-[76%]">
          <span className={`inline-flex items-center gap-1.5 text-xs ${statusClassName}`}>
            {isActive && job.status !== 'interrupted' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isSuccess ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <AlertTriangle className="size-3.5" />
            )}
            {getAgentJobStatusLabel(job.status)}
          </span>

          {job.resultSummary ? (
            <div className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
              {job.resultSummary}
            </div>
          ) : job.errorMessage ? (
            <p className="mt-3 rounded-2xl border border-rose-300/14 bg-rose-950/18 p-3 text-sm leading-6 text-rose-100/86">
              {job.errorMessage}
            </p>
          ) : isActive ? (
            <p className="mt-3 text-sm text-slate-400">Working...</p>
          ) : null}
        </div>
      </div>

      {pendingRequest ? (
        <form
          className="ml-0 space-y-3 rounded-2xl border border-amber-300/14 bg-amber-950/16 p-3 sm:ml-11"
          onSubmit={(event) => {
            event.preventDefault()
            const responseText = humanInputResponse.trim()

            if (responseText) {
              onAnswerHumanInputRequest(pendingRequest.requestId, responseText)
              setHumanInputResponse('')
            }
          }}
        >
          <div>
            <p className="text-xs font-medium text-amber-200/70">Human input needed</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-amber-50/88">
              {pendingRequest.promptText}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              className="min-h-20 flex-1 resize-none rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-200/50"
              onChange={(event) => setHumanInputResponse(event.target.value)}
              placeholder="Reply to Codex..."
              value={humanInputResponse}
            />
            <button
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-amber-300 px-4 text-sm font-medium text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!humanInputResponse.trim()}
              type="submit"
            >
              Send Reply
            </button>
          </div>
        </form>
      ) : null}
    </article>
  )
}

function PromptComposer({
  disabled,
  isSubmitting,
  onSubmit,
  prompt,
  setPrompt
}: {
  disabled: boolean
  isSubmitting: boolean
  onSubmit: () => void
  prompt: string
  setPrompt: (value: string) => void
}): React.JSX.Element {
  const submitDisabled = disabled || isSubmitting || !prompt.trim()
  const inputDisabled = disabled || isSubmitting

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#080d14]/96 px-3 py-3 sm:px-5 sm:py-4">
      <form
        className="mx-auto flex max-w-[820px] items-end gap-2 rounded-xl border border-white/14 bg-[#111822]/96 p-2 shadow-[0_18px_80px_rgba(0,0,0,0.3)] transition-colors focus-within:border-blue-300/35"
        onSubmit={(event) => {
          event.preventDefault()

          if (!submitDisabled) {
            onSubmit()
          }
        }}
      >
        <textarea
          className="max-h-44 min-h-12 min-w-0 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-[15px] leading-6 text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={inputDisabled}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !submitDisabled) {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder="Message Codex"
          value={prompt}
        />

        <button
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-white/14 disabled:text-slate-500"
          disabled={submitDisabled}
          type="submit"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizontal className="size-4" />
          )}
          <span className="sr-only">Send prompt</span>
        </button>
      </form>
    </div>
  )
}

function EmptyWorkspaceState({ hasWorkers }: { hasWorkers: boolean }): React.JSX.Element {
  return (
    <div className="flex min-h-[360px] flex-1 items-center justify-center px-6 py-10">
      <div className="max-w-md rounded-lg border border-dashed border-white/12 bg-white/[0.025] px-8 py-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200">
          <Folder className="size-5" />
        </div>
        <h2 className="mt-5 text-xl font-medium text-white">
          {hasWorkers ? 'Choose a repository' : 'No desktop worker'}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {hasWorkers
            ? 'Select a synced repository from the sidebar.'
            : 'Open the Electron app with this account to publish local workspace state.'}
        </p>
      </div>
    </div>
  )
}

function Notice({
  message,
  tone
}: {
  message: string
  tone: 'warning' | 'error' | 'success'
}): React.JSX.Element {
  if (tone === 'success') {
    return (
      <div className="border-b border-emerald-300/12 bg-emerald-300/7 px-6 py-3 text-sm text-emerald-50">
        {message}
      </div>
    )
  }

  return (
    <div
      className={
        tone === 'error'
          ? 'border-b border-rose-300/12 bg-rose-300/7 px-6 py-3 text-sm text-rose-50'
          : 'border-b border-amber-300/12 bg-amber-300/7 px-6 py-3 text-sm text-amber-50'
      }
    >
      {message}
    </div>
  )
}

function StatusPill({ status }: { status: DisplayWorkerStatus }): React.JSX.Element {
  return (
    <span
      className={joinClassNames(
        'inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium',
        status === 'Offline'
          ? 'border-slate-400/20 text-slate-300'
          : status === 'Busy'
            ? 'border-blue-300/20 bg-blue-300/10 text-blue-100'
            : 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
      )}
    >
      {status}
    </span>
  )
}

function StatusDot({ status }: { status: DisplayWorkerStatus }): React.JSX.Element {
  return (
    <span
      aria-label={status}
      className={joinClassNames(
        'size-2 shrink-0 rounded-full',
        status === 'Offline' ? 'bg-slate-500' : status === 'Busy' ? 'bg-blue-300' : 'bg-emerald-300'
      )}
    />
  )
}

function SidebarLoadingRows(): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="h-16 animate-pulse rounded-lg border border-white/8 bg-white/[0.025]" />
      <div className="h-16 animate-pulse rounded-lg border border-white/8 bg-white/[0.025]" />
    </div>
  )
}

function FeatureCard({
  eyebrow,
  text,
  title
}: {
  eyebrow: string
  text: string
  title: string
}): React.JSX.Element {
  return (
    <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-300/56">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-lg font-medium text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-300/75">{text}</p>
    </article>
  )
}

function CenteredStatus({
  compact = false,
  message
}: {
  compact?: boolean
  message: string
}): React.JSX.Element {
  return (
    <div
      className={
        compact
          ? 'flex min-h-[360px] w-full items-center justify-center px-6 text-center text-sm text-slate-200/80'
          : 'flex min-h-dvh items-center justify-center px-6 text-center text-sm text-slate-200/80'
      }
    >
      {message}
    </div>
  )
}

function StatusInner(): React.JSX.Element {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <MissingConvexUrl />
  }

  return <ConnectedStatus />
}

export function ConvexStatusCard(): React.JSX.Element {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <MissingAuthKey />
  }

  return (
    <ConvexProviders>
      <StatusInner />
    </ConvexProviders>
  )
}
