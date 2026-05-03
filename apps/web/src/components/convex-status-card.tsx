'use client'

import { SignInButton, SignedIn, SignedOut, UserButton, useAuth } from '@clerk/nextjs'
import { api } from '@deskbinder/convex-client'
import { useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { ConvexProviders } from './providers'

const WORKER_ONLINE_THRESHOLD_MS = 90_000

type DesktopWorkerSummary = {
  workerId: string
  name: string
  status: 'online' | 'busy' | 'offline'
  autoRunEnabled: boolean
  lastSeenAt: number | null
}

type DesktopRepoSummary = {
  workerId: string
  localRepoId: string
  name: string
  currentBranch: string
  isValid: boolean
  readinessStatus: 'ready' | 'invalid' | 'dirty' | 'missing_script' | 'missing_repo' | 'error'
  readinessMessage: string | null
  lastSeenAt: number
}

function formatLastSeen(lastSeenAt: number | null): string {
  if (!lastSeenAt) {
    return 'No heartbeat yet'
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(lastSeenAt))
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

function getWorkerDisplayStatus(worker: DesktopWorkerSummary, now: number): string {
  if (
    worker.status !== 'offline' &&
    worker.lastSeenAt &&
    now - worker.lastSeenAt <= WORKER_ONLINE_THRESHOLD_MS
  ) {
    return worker.status === 'busy' ? 'Busy' : 'Online'
  }

  return 'Offline'
}

function MissingAuthKey(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-200/75">
        Setup required
      </p>
      <h2 className="text-3xl font-semibold tracking-tight text-white">
        Add the web Clerk public key
      </h2>
      <p className="text-sm leading-7 text-amber-100/85">
        Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> in <code>apps/web/.env.local</code>, then
        restart the Next dev server.
      </p>
    </div>
  )
}

function ConnectedStatus(): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()
  const viewer = useQuery(api.auth.viewer, isSignedIn ? {} : 'skip')
  const workers = useQuery(api.workers.listDesktopWorkers, isSignedIn ? {} : 'skip')
  const repos = useQuery(api.repos.listDesktopRepos, isSignedIn ? {} : 'skip')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now())
    }, 30_000)

    return () => window.clearInterval(intervalId)
  }, [])

  if (!isLoaded) {
    return <p className="text-sm text-slate-300/80">Loading authentication state...</p>
  }

  return (
    <div className="space-y-6">
      <SignedOut>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-200/72">
              Login
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              Sign in to Deskbinder
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-300/82">
              Use the shared Clerk app to access the web dashboard.
            </p>
          </div>
          <SignInButton mode="modal">
            <button className="rounded-full bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200">
              Sign in
            </button>
          </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-200/72">
                Dashboard
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {viewer ? `Welcome, ${viewer.name ?? 'there'}` : 'Loading your dashboard'}
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-300/82">
                This view is authenticated through Clerk and resolved from the shared Convex
                backend.
              </p>
            </div>
            <UserButton />
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-black/25 p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Current user</p>
            {viewer ? (
              <p className="mt-3 text-2xl font-semibold text-white">
                {viewer.name ?? 'Unknown user'}
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-300/80">Loading your profile...</p>
            )}
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-black/25 p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Desktop workers</p>
            {!workers ? (
              <p className="mt-3 text-sm text-slate-300/80">Loading desktop workers...</p>
            ) : workers.length === 0 ? (
              <p className="mt-3 text-sm text-slate-300/80">
                Open the desktop app with this account to register a worker.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {workers.map((worker) => {
                  const displayStatus = getWorkerDisplayStatus(worker, now)
                  const workerRepos = (repos ?? []).filter(
                    (repo) => repo.workerId === worker.workerId
                  )

                  return (
                    <div
                      className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"
                      key={worker.workerId}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium text-white">{worker.name}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            Worker {worker.workerId.slice(0, 8)}
                          </p>
                        </div>
                        <span
                          className={
                            displayStatus === 'Offline'
                              ? 'rounded-full border border-slate-400/20 px-2.5 py-1 text-xs font-medium text-slate-300'
                              : 'rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-xs font-medium text-emerald-100'
                          }
                        >
                          {displayStatus}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-300/80">
                        <div>
                          <p className="uppercase tracking-[0.2em] text-slate-500">Last seen</p>
                          <p className="mt-1 text-slate-200">{formatLastSeen(worker.lastSeenAt)}</p>
                        </div>
                        <div>
                          <p className="uppercase tracking-[0.2em] text-slate-500">Auto-run</p>
                          <p className="mt-1 text-slate-200">
                            {worker.autoRunEnabled ? 'Enabled' : 'Disabled'}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 border-t border-white/8 pt-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Repos</p>
                        {!repos ? (
                          <p className="mt-2 text-sm text-slate-300/80">Loading repos...</p>
                        ) : workerRepos.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-300/80">
                            No synced repositories yet.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {workerRepos.map((repo) => (
                              <div
                                className="rounded-xl border border-white/8 bg-black/15 p-3"
                                key={repo.localRepoId}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium text-white">{repo.name}</p>
                                    <p className="mt-1 text-xs text-slate-400">
                                      {repo.currentBranch || 'No current branch'}
                                    </p>
                                  </div>
                                  <span
                                    className={
                                      repo.isValid
                                        ? 'rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-xs font-medium text-emerald-100'
                                        : 'rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-medium text-amber-100'
                                    }
                                  >
                                    {getReadinessLabel(repo.readinessStatus)}
                                  </span>
                                </div>
                                {repo.readinessMessage ? (
                                  <p className="mt-2 text-xs leading-5 text-slate-300/80">
                                    {repo.readinessMessage}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </SignedIn>
    </div>
  )
}

function StatusInner(): React.JSX.Element {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-200/75">
          Setup required
        </p>
        <p className="text-sm leading-6 text-amber-100/85">
          Add <code>NEXT_PUBLIC_CONVEX_URL</code> to connect this app to the shared Convex
          deployment.
        </p>
      </div>
    )
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
