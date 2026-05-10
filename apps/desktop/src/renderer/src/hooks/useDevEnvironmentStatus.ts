import type { DevEnvironmentStatus } from '@deskbinder/shared/deskbinder'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { useCallback, useEffect, useRef, useState } from 'react'

const DEV_ENVIRONMENT_STATUS_INTERVAL_MS = 5_000

type UseDevEnvironmentStatusOptions = {
  desktopApi: DeskbinderApi | null
  repoId: string | null
  enabled: boolean
}

type UseDevEnvironmentStatusResult = {
  status: DevEnvironmentStatus | null
  error: string | null
  refresh: () => Promise<void>
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to check dev environment status.'
}

export function useDevEnvironmentStatus({
  desktopApi,
  enabled,
  repoId
}: UseDevEnvironmentStatusOptions): UseDevEnvironmentStatusResult {
  const [status, setStatus] = useState<DevEnvironmentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence

    if (!enabled || !desktopApi || !repoId) {
      setStatus(null)
      setError(null)
      return
    }

    try {
      const nextStatus = await desktopApi.getDevEnvironmentStatus({ repoId })

      if (requestSequence.current !== sequence) {
        return
      }

      setStatus(nextStatus)
      setError(null)
    } catch (statusError) {
      if (requestSequence.current !== sequence) {
        return
      }

      setError(toErrorMessage(statusError))
    }
  }, [desktopApi, enabled, repoId])

  useEffect(() => {
    if (!enabled || !desktopApi || !repoId) {
      requestSequence.current += 1
      setStatus(null)
      setError(null)
      return
    }

    void refresh()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, DEV_ENVIRONMENT_STATUS_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [desktopApi, enabled, refresh, repoId])

  return {
    status,
    error,
    refresh
  }
}
