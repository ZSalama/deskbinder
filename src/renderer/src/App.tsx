import { SignIn, SignOutButton, SignUp, useAuth, useUser } from '@clerk/react'
import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import wavyLines from './assets/wavy-lines.svg'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function App(): React.JSX.Element {
  if (!publishableKey) {
    return <ConfigurationError />
  }

  return (
    <div className="min-h-screen bg-[#07131a] text-slate-100">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(46,144,250,0.18),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,0.14),transparent_28%),linear-gradient(180deg,#061018_0%,#07131a_42%,#020608_100%)]" />
      <div
        className="fixed inset-0 opacity-20 mix-blend-screen"
        style={{ backgroundImage: `url(${wavyLines})` }}
      />

      <main className="relative z-10 min-h-screen px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/sign-in/*" element={<AuthPage mode="sign-in" />} />
          <Route path="/sign-up/*" element={<AuthPage mode="sign-up" />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </main>
    </div>
  )
}

function ConfigurationError(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#061018] px-6 text-slate-100">
      <section className="w-full max-w-xl rounded-[28px] border border-amber-300/20 bg-amber-100/10 p-8 shadow-2xl backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-200/80">
          Clerk setup required
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Add your publishable key</h1>
        <p className="mt-4 text-sm leading-6 text-slate-200/80">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in your environment before starting the app.
        </p>
      </section>
    </main>
  )
}

function HomeRedirect(): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return <CenteredStatus message="Loading authentication…" />
  }

  return <Navigate replace to={isSignedIn ? '/dashboard' : '/sign-in'} />
}

function ProtectedRoute({ children }: { children: React.JSX.Element }): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return <CenteredStatus message="Loading your workspace…" />
  }

  if (!isSignedIn) {
    return <Navigate replace to="/sign-in" />
  }

  return children
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return <CenteredStatus message="Preparing authentication…" />
  }

  if (isSignedIn) {
    return <Navigate replace to="/dashboard" />
  }

  return (
    <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center justify-center">
      <div className="grid w-full gap-6 overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/70 shadow-[0_32px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col justify-between border-b border-white/8 p-8 sm:p-10 lg:border-r lg:border-b-0 lg:p-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200/72">
              Deskbinder
            </p>
            <h1 className="mt-6 max-w-md text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Keep your desk in sync with one secure account.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300/78">
              Create an account or sign in to access your dashboard. This first version only shows
              account details, but the auth flow is ready for the rest of the app.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <FeatureCard
              eyebrow="Account"
              title="Email and password"
              text="Clerk handles sign-up, sign-in, verification, and session state inside the renderer."
            />
            <FeatureCard
              eyebrow="Security"
              title="Electron-safe boundary"
              text="Authentication lives in the UI layer while main and preload stay locked down."
            />
          </div>
        </div>

        <div className="flex items-center justify-center p-6 sm:p-8 lg:p-10">
          {mode === 'sign-in' ? (
            <SignIn
              path="/sign-in"
              routing="path"
              signUpUrl="/sign-up"
              fallback={<CenteredStatus compact message="Loading sign in…" />}
              appearance={clerkAppearance}
            />
          ) : (
            <SignUp
              path="/sign-up"
              routing="path"
              signInUrl="/sign-in"
              fallback={<CenteredStatus compact message="Loading sign up…" />}
              appearance={clerkAppearance}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function DashboardPage(): React.JSX.Element {
  const { user } = useUser()
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [isPickingFolder, setIsPickingFolder] = useState(false)

  if (!user) {
    return <CenteredStatus message="Loading your dashboard…" />
  }

  const createdAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(user.createdAt ?? undefined)

  async function handlePickFolder(): Promise<void> {
    setIsPickingFolder(true)

    try {
      const result = await window.api.pickFolder()

      if (!result.canceled) {
        setSelectedFolder(result.path)
      }
    } finally {
      setIsPickingFolder(false)
    }
  }

  return (
    <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center justify-center">
      <div className="w-full rounded-[32px] border border-white/10 bg-slate-950/72 p-6 shadow-[0_32px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8 lg:p-10">
        <div className="flex flex-col gap-6 border-b border-white/10 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <img
              alt={
                user.fullName ?? user.username ?? user.primaryEmailAddress?.emailAddress ?? 'User'
              }
              className="h-16 w-16 rounded-2xl border border-white/10 object-cover shadow-lg"
              src={user.imageUrl}
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-emerald-200/72">
                Dashboard
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {user.fullName ?? user.username ?? 'Account'}
              </h1>
              <p className="mt-2 text-sm text-slate-300/78">
                Signed in as {user.primaryEmailAddress?.emailAddress ?? 'unknown email'}
              </p>
            </div>
          </div>

          <SignOutButton>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer rounded-full border-white/12 bg-white/8 px-5 text-white hover:border-white/22 hover:bg-white/14 hover:text-white"
            >
              Sign out
            </Button>
          </SignOutButton>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <InfoCard label="User ID" value={user.id} />
          <InfoCard
            label="Primary email"
            value={user.primaryEmailAddress?.emailAddress ?? 'Not set'}
          />
          <InfoCard label="Username" value={user.username ?? 'Not set'} />
          <InfoCard label="Created" value={createdAt} />
        </div>

        <div className="mt-6 rounded-[24px] border border-cyan-200/10 bg-cyan-300/5 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-200/72">
                Workspace Folder
              </p>
              <h2 className="mt-3 text-lg font-medium text-white">
                Pick a folder from your machine
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-300/75">
                The renderer requests a single folder through the Electron main process.
              </p>
            </div>

            <Button
              type="button"
              className="cursor-pointer rounded-full bg-cyan-300 px-5 text-slate-950 hover:bg-cyan-200"
              disabled={isPickingFolder}
              onClick={() => void handlePickFolder()}
            >
              {isPickingFolder ? 'Opening…' : 'Choose folder'}
            </Button>
          </div>

          <div className="mt-5 rounded-2xl border border-white/8 bg-slate-950/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-300/56">
              Selected folder
            </p>
            <p className="mt-3 break-all text-sm leading-6 text-white">
              {selectedFolder ?? 'No folder selected yet'}
            </p>
          </div>
        </div>
      </div>
    </section>
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

function InfoCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-300/56">
        {label}
      </p>
      <p className="mt-3 wrap-break-word text-sm leading-6 text-white">{value}</p>
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
          ? 'flex min-h-130 w-full items-center justify-center rounded-[28px] border border-white/8 bg-white/4 px-6 text-center text-sm text-slate-200/80'
          : 'flex min-h-[calc(100vh-3rem)] items-center justify-center text-center text-sm text-slate-200/80'
      }
    >
      {message}
    </div>
  )
}

const clerkAppearance = {
  elements: {
    cardBox:
      'w-full rounded-[28px] border border-white/8 bg-white/5 shadow-none backdrop-blur md:min-w-[420px]',
    card: 'bg-transparent shadow-none',
    footerActionLink: 'text-cyan-200 hover:text-cyan-100',
    formButtonPrimary:
      'bg-cyan-400 text-slate-950 shadow-none hover:bg-cyan-300 focus-visible:ring-cyan-200',
    formFieldInput:
      'rounded-xl border border-white/10 bg-slate-900/80 text-white placeholder:text-slate-500 focus:border-cyan-300 focus:ring-cyan-300',
    formFieldLabel: 'text-slate-200',
    headerTitle: 'text-white',
    headerSubtitle: 'text-slate-300',
    identityPreviewText: 'text-white',
    identityPreviewEditButton: 'text-cyan-200',
    socialButtonsBlockButton:
      'border border-white/10 bg-slate-900/80 text-white hover:bg-slate-900',
    socialButtonsBlockButtonText: 'text-white'
  }
}

export default App
