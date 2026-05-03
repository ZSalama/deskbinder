import { api } from '@deskbinder/convex-client'
import type { DeskbinderConfig } from '@deskbinder/shared/deskbinder'
import { useMutation } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'

const HEARTBEAT_INTERVAL_MS = 30_000

type UseWorkerHeartbeatOptions = {
  config: DeskbinderConfig | null
  enabled: boolean
}

type UseWorkerHeartbeatResult = {
  error: string | null
}

function buildWorkerName(workerId: string): string {
  return `Deskbinder Desktop ${workerId.slice(0, 8)}`
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to update desktop worker heartbeat.'
}

export function useWorkerHeartbeat({
  config,
  enabled
}: UseWorkerHeartbeatOptions): UseWorkerHeartbeatResult {
  const registerDesktopWorker = useMutation(api.workers.registerDesktopWorker)
  const heartbeatDesktopWorker = useMutation(api.workers.heartbeatDesktopWorker)
  const [error, setError] = useState<string | null>(null)
  const workerId = config?.workerId ?? null
  const autoRunEnabled = config?.appSettings.autoRunEnabled ?? false
  const workerName = useMemo(() => (workerId ? buildWorkerName(workerId) : null), [workerId])

  useEffect(() => {
    if (!enabled || !workerId || !workerName) {
      return
    }

    let isActive = true

    const register = async (): Promise<void> => {
      try {
        await registerDesktopWorker({
          workerId,
          name: workerName,
          autoRunEnabled,
          status: 'online'
        })

        if (isActive) {
          setError(null)
        }
      } catch (registrationError) {
        if (isActive) {
          setError(toErrorMessage(registrationError))
        }
      }
    }

    const heartbeat = async (): Promise<void> => {
      try {
        await heartbeatDesktopWorker({
          workerId,
          autoRunEnabled,
          status: 'online'
        })

        if (isActive) {
          setError(null)
        }
      } catch (heartbeatError) {
        if (isActive) {
          setError(toErrorMessage(heartbeatError))
        }
      }
    }

    void register()

    const intervalId = window.setInterval(() => {
      void heartbeat()
    }, HEARTBEAT_INTERVAL_MS)

    return () => {
      isActive = false
      window.clearInterval(intervalId)
    }
  }, [autoRunEnabled, enabled, heartbeatDesktopWorker, registerDesktopWorker, workerId, workerName])

  return {
    error
  }
}
