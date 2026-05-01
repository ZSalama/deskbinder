'use client'

import { SignInButton, SignedIn, SignedOut, UserButton, useAuth } from '@clerk/nextjs'
import { api } from '@deskbinder/convex-client'
import { useQuery } from 'convex/react'
import { ConvexProviders } from './providers'

function MissingAuthKey(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-200/75">
        Setup required
      </p>
      <h2 className="text-3xl font-semibold tracking-tight text-white">Add the web Clerk public key</h2>
      <p className="text-sm leading-7 text-amber-100/85">
        Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> in <code>apps/web/.env.local</code>,
        then restart the Next dev server.
      </p>
    </div>
  )
}

function ConnectedStatus(): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()
  const viewer = useQuery(api.auth.viewer, isSignedIn ? {} : 'skip')

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
              <p className="mt-3 text-2xl font-semibold text-white">{viewer.name ?? 'Unknown user'}</p>
            ) : (
              <p className="mt-3 text-sm text-slate-300/80">Loading your profile...</p>
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
