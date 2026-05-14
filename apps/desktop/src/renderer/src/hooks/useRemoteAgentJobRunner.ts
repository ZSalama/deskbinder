import { api } from '@deskbinder/convex-client'
import type { Id } from '@deskbinder/convex-client'
import type { AgentRunEvent, LocalDeviceConfig } from '@deskbinder/shared/deskbinder'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'

type QueuedAgentJob = {
  jobId: Id<'agentJobs'>
  targetWorkerId: string
  targetRepoId: string
  promptText: string
}

type AnsweredHumanInputRequest = {
  requestId: Id<'agentJobHumanInputRequests'>
  jobId: Id<'agentJobs'>
  targetRepoId: string
  promptText: string
  responseText: string
  createdAt: number
}

type ClaimedRemoteJob = QueuedAgentJob & {
  attemptId: Id<'agentJobAttempts'>
  codexThreadId?: string
  humanInputRequestId?: Id<'agentJobHumanInputRequests'>
  humanInputResponseText?: string
}

export type ActiveRemoteAgentJob = {
  jobId: Id<'agentJobs'>
  targetRepoId: string
  runId?: string
}

type CompletedAgentEvent = Extract<AgentRunEvent, { type: 'completed' }>

type UseRemoteAgentJobRunnerOptions = {
  deviceConfig: LocalDeviceConfig | null
  desktopApi: DeskbinderApi | null
  enabled: boolean
  onNotice: (notice: { tone: 'error' | 'success' | 'warning'; message: string }) => void
}

type UseRemoteAgentJobRunnerResult = {
  activeJobs: ActiveRemoteAgentJob[]
  error: string | null
}

type RemoteCandidate =
  | { kind: 'answered'; request: AnsweredHumanInputRequest }
  | { kind: 'queued'; job: QueuedAgentJob }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to run remote agent job.'
}

function getFailureMessage(event: CompletedAgentEvent): string {
  return event.errorMessage ?? 'Codex failed.'
}

function rememberCompletedEvent(
  completedEvents: Map<string, CompletedAgentEvent>,
  event: CompletedAgentEvent
): void {
  completedEvents.set(event.runId, event)

  if (completedEvents.size <= 25) {
    return
  }

  const oldestRunId = completedEvents.keys().next().value

  if (oldestRunId) {
    completedEvents.delete(oldestRunId)
  }
}

function getCandidateJobId(candidate: RemoteCandidate): Id<'agentJobs'> {
  return candidate.kind === 'answered' ? candidate.request.jobId : candidate.job.jobId
}

function getCandidateRepoId(candidate: RemoteCandidate): string {
  return candidate.kind === 'answered' ? candidate.request.targetRepoId : candidate.job.targetRepoId
}

export function useRemoteAgentJobRunner({
  deviceConfig,
  desktopApi,
  enabled,
  onNotice
}: UseRemoteAgentJobRunnerOptions): UseRemoteAgentJobRunnerResult {
  const workerId = deviceConfig?.workerId ?? null
  const queuedJobs = useQuery(
    api.agentJobs.listQueuedAgentJobs,
    enabled && workerId ? { workerId } : 'skip'
  )
  const answeredHumanInputRequests = useQuery(
    api.agentJobs.listAnsweredHumanInputRequests,
    enabled && workerId ? { workerId } : 'skip'
  )
  const claimAgentJob = useMutation(api.agentJobs.claimAgentJob)
  const claimAnsweredHumanInputRequest = useMutation(api.agentJobs.claimAnsweredHumanInputRequest)
  const markAgentJobRunning = useMutation(api.agentJobs.markAgentJobRunning)
  const completeAgentJob = useMutation(api.agentJobs.completeAgentJob)
  const interruptAgentJob = useMutation(api.agentJobs.interruptAgentJob)
  const [activeJobs, setActiveJobs] = useState<ActiveRemoteAgentJob[]>([])
  const [error, setError] = useState<string | null>(null)
  const activeJobIdsRef = useRef(new Set<Id<'agentJobs'>>())
  const activeRepoIdsRef = useRef(new Set<string>())
  const completedEventsRef = useRef(new Map<string, CompletedAgentEvent>())
  const completionResolversRef = useRef(new Map<string, (event: CompletedAgentEvent) => void>())
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    return desktopApi.onAgentEvent((event) => {
      if (event.type !== 'completed') {
        return
      }

      rememberCompletedEvent(completedEventsRef.current, event)
      completionResolversRef.current.get(event.runId)?.(event)
      completionResolversRef.current.delete(event.runId)
    })
  }, [desktopApi])

  useEffect(() => {
    if (!enabled || !desktopApi || !workerId) {
      return
    }

    const candidates: RemoteCandidate[] = [
      ...((answeredHumanInputRequests ?? []) as AnsweredHumanInputRequest[]).map((request) => ({
        kind: 'answered' as const,
        request
      })),
      ...((queuedJobs ?? []) as QueuedAgentJob[]).map((job) => ({
        kind: 'queued' as const,
        job
      }))
    ]
    const repoIdsReservedInThisPass = new Set<string>()
    const runnableCandidates = candidates.filter((candidate) => {
      const jobId = getCandidateJobId(candidate)
      const repoId = getCandidateRepoId(candidate)

      if (
        activeJobIdsRef.current.has(jobId) ||
        activeRepoIdsRef.current.has(repoId) ||
        repoIdsReservedInThisPass.has(repoId)
      ) {
        return false
      }

      repoIdsReservedInThisPass.add(repoId)
      return true
    })

    if (runnableCandidates.length === 0) {
      return
    }

    const waitForCompletion = async (runId: string): Promise<CompletedAgentEvent> => {
      const completedEvent = completedEventsRef.current.get(runId)

      if (completedEvent) {
        completedEventsRef.current.delete(runId)
        return completedEvent
      }

      return await new Promise((resolvePromise) => {
        completionResolversRef.current.set(runId, (event) => {
          completedEventsRef.current.delete(runId)
          resolvePromise(event)
        })
      })
    }

    const setActiveJob = (activeJob: ActiveRemoteAgentJob): void => {
      if (!isMountedRef.current) {
        return
      }

      setActiveJobs((currentJobs) => {
        const existingIndex = currentJobs.findIndex((job) => job.jobId === activeJob.jobId)

        if (existingIndex === -1) {
          return [...currentJobs, activeJob]
        }

        return currentJobs.map((job, index) => (index === existingIndex ? activeJob : job))
      })
    }

    const removeActiveJob = (jobId: Id<'agentJobs'>): void => {
      if (!isMountedRef.current) {
        return
      }

      setActiveJobs((currentJobs) => currentJobs.filter((job) => job.jobId !== jobId))
    }

    const runCandidate = async (candidate: RemoteCandidate): Promise<void> => {
      const reservedJobId = getCandidateJobId(candidate)
      const reservedRepoId = getCandidateRepoId(candidate)
      let claimedJob: ClaimedRemoteJob | null = null

      activeJobIdsRef.current.add(reservedJobId)
      activeRepoIdsRef.current.add(reservedRepoId)

      try {
        if (candidate.kind === 'answered') {
          claimedJob = await claimAnsweredHumanInputRequest({
            requestId: candidate.request.requestId,
            workerId
          })
        } else {
          claimedJob = await claimAgentJob({
            jobId: candidate.job.jobId,
            workerId
          })
        }

        if (!claimedJob) {
          return
        }

        setActiveJob({
          jobId: claimedJob.jobId,
          targetRepoId: claimedJob.targetRepoId
        })

        const response = await desktopApi.runAgent({
          repoId: claimedJob.targetRepoId,
          promptText: claimedJob.humanInputResponseText ?? claimedJob.promptText,
          resumeThreadId: claimedJob.codexThreadId
        })

        if (!response.ok) {
          await completeAgentJob({
            jobId: claimedJob.jobId,
            attemptId: claimedJob.attemptId,
            workerId,
            status: 'failed',
            errorMessage: response.errorMessage
          })
          throw new Error(response.errorMessage)
        }

        setActiveJob({
          jobId: claimedJob.jobId,
          targetRepoId: claimedJob.targetRepoId,
          runId: response.runId
        })

        await markAgentJobRunning({
          jobId: claimedJob.jobId,
          attemptId: claimedJob.attemptId,
          workerId,
          runId: response.runId
        })

        const completedEvent = await waitForCompletion(response.runId)

        if (completedEvent.status === 'interrupted') {
          await interruptAgentJob({
            jobId: claimedJob.jobId,
            attemptId: claimedJob.attemptId,
            workerId,
            runId: completedEvent.runId,
            codexThreadId: completedEvent.codexThreadId,
            promptText:
              completedEvent.humanInputPrompt ??
              completedEvent.lastMessage ??
              'Codex needs human input before it can continue.',
            resultSummary: completedEvent.lastMessage
          })
        } else {
          await completeAgentJob({
            jobId: claimedJob.jobId,
            attemptId: claimedJob.attemptId,
            workerId,
            status: completedEvent.status,
            exitCode: completedEvent.exitCode,
            signal: completedEvent.signal,
            errorMessage: completedEvent.errorMessage,
            resultSummary: completedEvent.lastMessage
          })
        }

        if (!isMountedRef.current) {
          return
        }

        const workspaceLabel = claimedJob.targetRepoId.slice(0, 8)
        setError(
          completedEvent.status === 'succeeded' || completedEvent.status === 'interrupted'
            ? null
            : getFailureMessage(completedEvent)
        )
        onNotice(
          completedEvent.status === 'succeeded'
            ? {
                tone: 'success',
                message: `Remote Codex job completed for workspace ${workspaceLabel}.`
              }
            : completedEvent.status === 'interrupted'
              ? {
                  tone: 'warning',
                  message: `Remote Codex job is waiting for human input in workspace ${workspaceLabel}.`
                }
              : {
                  tone: 'error',
                  message: `Remote Codex job failed for workspace ${workspaceLabel}: ${getFailureMessage(completedEvent)}`
                }
        )
      } catch (runError) {
        const message = toErrorMessage(runError)

        if (claimedJob) {
          try {
            await completeAgentJob({
              jobId: claimedJob.jobId,
              attemptId: claimedJob.attemptId,
              workerId,
              status: 'failed',
              errorMessage: message
            })
          } catch {
            // The original failure is more useful to surface in the desktop UI.
          }
        }

        if (isMountedRef.current) {
          const workspaceLabel = reservedRepoId.slice(0, 8)
          setError(message)
          onNotice({
            tone: 'error',
            message: `Remote Codex job failed for workspace ${workspaceLabel}: ${message}`
          })
        }
      } finally {
        activeJobIdsRef.current.delete(reservedJobId)
        activeRepoIdsRef.current.delete(reservedRepoId)
        removeActiveJob(reservedJobId)
      }
    }

    for (const candidate of runnableCandidates) {
      void runCandidate(candidate)
    }
  }, [
    claimAgentJob,
    claimAnsweredHumanInputRequest,
    completeAgentJob,
    desktopApi,
    enabled,
    answeredHumanInputRequests,
    interruptAgentJob,
    markAgentJobRunning,
    onNotice,
    queuedJobs,
    workerId
  ])

  return {
    activeJobs,
    error
  }
}
