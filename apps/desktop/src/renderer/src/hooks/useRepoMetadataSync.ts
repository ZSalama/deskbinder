import { api } from '@deskbinder/convex-client'
import type { DeskbinderConfig } from '@deskbinder/shared/deskbinder'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'

const REPO_SYNC_INTERVAL_MS = 30_000

type UseRepoMetadataSyncOptions = {
  config: DeskbinderConfig | null
  desktopApi: DeskbinderApi | null
  enabled: boolean
}

type UseRepoMetadataSyncResult = {
  error: string | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to sync repo metadata.'
}

export function useRepoMetadataSync({
  config,
  desktopApi,
  enabled
}: UseRepoMetadataSyncOptions): UseRepoMetadataSyncResult {
  const syncDesktopRepos = useMutation(api.repos.syncDesktopRepos)
  const [error, setError] = useState<string | null>(null)
  const workerId = config?.workerId ?? null

  useEffect(() => {
    if (!enabled || !desktopApi || !workerId) {
      return
    }

    let isActive = true

    const syncRepos = async (): Promise<void> => {
      try {
        const metadata = await desktopApi.getRepoSyncMetadata()

        if (metadata.workerId !== workerId) {
          throw new Error('Local repo metadata worker mismatch.')
        }

        await syncDesktopRepos({
          workerId,
          repos: metadata.repos
        })

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
  }, [desktopApi, enabled, syncDesktopRepos, workerId, config])

  return {
    error
  }
}
