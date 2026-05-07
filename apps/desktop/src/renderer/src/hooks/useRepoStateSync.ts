import type { LocalDeviceConfig } from '@deskbinder/shared/deskbinder'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { useEffect, useState } from 'react'

const REPO_SYNC_INTERVAL_MS = 30_000

type UseRepoStateSyncOptions = {
  desktopApi: DeskbinderApi | null
  deviceConfig: LocalDeviceConfig | null
  enabled: boolean
}

type UseRepoStateSyncResult = {
  error: string | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to sync repo state.'
}

export function useRepoStateSync({
  desktopApi,
  deviceConfig,
  enabled
}: UseRepoStateSyncOptions): UseRepoStateSyncResult {
  const [error, setError] = useState<string | null>(null)
  const workerId = deviceConfig?.workerId ?? null

  useEffect(() => {
    if (!enabled || !desktopApi || !workerId) {
      return
    }

    let isActive = true

    const syncRepos = async (): Promise<void> => {
      try {
        await desktopApi.syncRepoStates()

        if (isActive) {
          setError(null)
        }
      } catch (syncError) {
        if (isActive) {
          setError(toErrorMessage(syncError))
        }
      }
    }

    void syncRepos()

    const intervalId = window.setInterval(() => {
      void syncRepos()
    }, REPO_SYNC_INTERVAL_MS)

    return () => {
      isActive = false
      window.clearInterval(intervalId)
    }
  }, [desktopApi, enabled, workerId])

  return {
    error
  }
}
