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

type ActiveRemoteAgentJob = {
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
  activeJob: ActiveRemoteAgentJob | null
  error: string | null
}

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
  const [activeJob, setActiveJob] = useState<ActiveRemoteAgentJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runningJobIdRef = useRef<Id<'agentJobs'> | null>(null)
  const completedEventsRef = useRef(new Map<string, CompletedAgentEvent>())
  const completionResolversRef = useRef(new Map<string, (event: CompletedAgentEvent) => void>())

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
    if (!enabled || !desktopApi || !workerId || runningJobIdRef.current) {
      return
    }

    const answeredRequest = answeredHumanInputRequests?.[0] as AnsweredHumanInputRequest | undefined
    const job = queuedJobs?.[0] as QueuedAgentJob | undefined

    if (!job && !answeredRequest) {
      return
    }

    let isActive = true
    runningJobIdRef.current = (answeredRequest?.jobId ?? job?.jobId) as Id<'agentJobs'>

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

    const runJob = async (): Promise<void> => {
      let claimedJob: ClaimedRemoteJob | null = null

      try {
        if (answeredRequest) {
          claimedJob = await claimAnsweredHumanInputRequest({
            requestId: answeredRequest.requestId,
            workerId
          })
        } else if (job) {
          claimedJob = await claimAgentJob({
            jobId: job.jobId,
            workerId
          })
        }

        if (!claimedJob) {
          return
        }

        if (isActive) {
          setActiveJob({
            jobId: claimedJob.jobId,
            targetRepoId: claimedJob.targetRepoId
          })
        }

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

        if (isActive) {
          setActiveJob({
            jobId: claimedJob.jobId,
            targetRepoId: claimedJob.targetRepoId,
            runId: response.runId
          })
        }

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

        if (isActive) {
          setError(
            completedEvent.status === 'succeeded' || completedEvent.status === 'interrupted'
              ? null
              : getFailureMessage(completedEvent)
          )
          onNotice(
            completedEvent.status === 'succeeded'
              ? {
                  tone: 'success',
                  message: 'Remote Codex job completed.'
                }
              : completedEvent.status === 'interrupted'
                ? {
                    tone: 'warning',
                    message: 'Remote Codex job is waiting for human input.'
                  }
                : {
                    tone: 'error',
                    message: getFailureMessage(completedEvent)
                  }
          )
        }
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

        if (isActive) {
          setError(message)
          onNotice({
            tone: 'error',
            message
          })
        }
      } finally {
        if (isActive) {
          setActiveJob(null)
        }

        runningJobIdRef.current = null
      }
    }

    void runJob()

    return () => {
      isActive = false
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
    activeJob,
    error
  }
}
