import { api } from '@deskbinder/convex-client'
import type { Id } from '@deskbinder/convex-client'
import type { LocalDeviceConfig, RunWorkspaceScriptResponse } from '@deskbinder/shared/deskbinder'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'

type BranchRequest = {
  requestId: Id<'branchRequests'>
  targetWorkerId: string
  sourceLocalRepoId: string
  branchName: string
}

type UseBranchRequestRunnerOptions = {
  deviceConfig: LocalDeviceConfig | null
  desktopApi: DeskbinderApi | null
  enabled: boolean
  onNotice: (notice: { tone: 'error' | 'success'; message: string }) => void
  onSelectedRepoId: (repoId: string | null) => void
}

type UseBranchRequestRunnerResult = {
  activeBranchName: string | null
  error: string | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to run remote branch request.'
}

function getFailureMessage(response: RunWorkspaceScriptResponse): string {
  return response.result.errorMessage ?? 'Workspace script failed.'
}

export function useBranchRequestRunner({
  deviceConfig,
  desktopApi,
  enabled,
  onNotice,
  onSelectedRepoId
}: UseBranchRequestRunnerOptions): UseBranchRequestRunnerResult {
  const workerId = deviceConfig?.workerId ?? null
  const queuedRequests = useQuery(
    api.branchRequests.listQueuedBranchRequests,
    enabled && workerId ? { workerId } : 'skip'
  )
  const claimBranchRequest = useMutation(api.branchRequests.claimBranchRequest)
  const completeBranchRequest = useMutation(api.branchRequests.completeBranchRequest)
  const [activeRequest, setActiveRequest] = useState<BranchRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runningRequestIdRef = useRef<Id<'branchRequests'> | null>(null)

  useEffect(() => {
    if (!enabled || !desktopApi || !workerId || runningRequestIdRef.current) {
      return
    }

    const request = queuedRequests?.[0] as BranchRequest | undefined

    if (!request) {
      return
    }

    let isActive = true
    runningRequestIdRef.current = request.requestId

    const runRequest = async (): Promise<void> => {
      try {
        const claimedRequest = await claimBranchRequest({
          requestId: request.requestId,
          workerId
        })

        if (!claimedRequest) {
          return
        }

        if (isActive) {
          setActiveRequest(request)
        }

        const response = await desktopApi.runWorkspaceScript({
          repoId: claimedRequest.sourceLocalRepoId,
          branchName: claimedRequest.branchName
        })

        onSelectedRepoId(response.selectedRepoId ?? claimedRequest.sourceLocalRepoId)

        await completeBranchRequest({
          requestId: claimedRequest.requestId,
          workerId,
          ok: response.result.ok,
          resultLocalRepoId: response.selectedRepoId ?? undefined,
          errorMessage: response.result.ok ? undefined : getFailureMessage(response)
        })

        if (isActive) {
          setError(response.result.ok ? null : getFailureMessage(response))
          onNotice(
            response.result.ok
              ? {
                  tone: 'success',
                  message: `Created ${response.result.branchName}.`
                }
              : {
                  tone: 'error',
                  message: getFailureMessage(response)
                }
          )
        }
      } catch (runError) {
        const message = toErrorMessage(runError)

        try {
          await completeBranchRequest({
            requestId: request.requestId,
            workerId,
            ok: false,
            errorMessage: message
          })
        } catch {
          // The original failure is more useful to surface in the desktop UI.
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
          setActiveRequest(null)
        }

        runningRequestIdRef.current = null
      }
    }

    void runRequest()

    return () => {
      isActive = false
    }
  }, [
    claimBranchRequest,
    completeBranchRequest,
    desktopApi,
    enabled,
    onNotice,
    onSelectedRepoId,
    queuedRequests,
    workerId
  ])

  return {
    activeBranchName: activeRequest?.branchName ?? null,
    error
  }
}
