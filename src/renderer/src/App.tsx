import { SignIn, SignUp, useAuth } from '@clerk/react'
import { useConvexAuth } from 'convex/react'
import { Navigate, Route, Routes } from 'react-router-dom'
import wavyLines from './assets/wavy-lines.svg'
import { DashboardLayout } from './components/dashboard/DashboardLayout'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const convexUrl = import.meta.env.VITE_CONVEX_URL

function App(): React.JSX.Element {
  if (!publishableKey || !convexUrl) {
    return <ConfigurationError />
  }

  return (
    <div className="h-dvh min-w-[1024px] overflow-hidden bg-[#07131a] text-slate-100">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(46,144,250,0.18),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,0.14),transparent_28%),linear-gradient(180deg,#061018_0%,#07131a_42%,#020608_100%)]" />
      <div
        className="fixed inset-0 opacity-20 mix-blend-screen"
        style={{ backgroundImage: `url(${wavyLines})` }}
      />

      <main className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden px-6 py-8">
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
    <main className="flex h-dvh items-center justify-center overflow-hidden bg-[#061018] px-6 text-slate-100">
      <section className="w-full max-w-xl rounded-[28px] border border-amber-300/20 bg-amber-100/10 p-8 shadow-2xl backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-200/80">
          Auth setup required
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Add your auth environment</h1>
        <p className="mt-4 text-sm leading-6 text-slate-200/80">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and <code>VITE_CONVEX_URL</code> in
          your environment before starting the app.
        </p>
      </section>
    </main>
  )
}

function HomeRedirect(): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()
  const { isLoading, isAuthenticated } = useConvexAuth()

  if (!isLoaded || isLoading) {
    return <CenteredStatus message="Loading authentication..." />
  }

  if (isSignedIn) {
    return <Navigate replace to="/dashboard" />
  }

  return <Navigate replace to="/sign-in" />
}

function ProtectedRoute({ children }: { children: React.JSX.Element }): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()
  const { isLoading, isAuthenticated } = useConvexAuth()

  if (!isLoaded || isLoading) {
    return <CenteredStatus message="Loading your workspace..." />
  }

  if (!isSignedIn) {
    return <Navigate replace to="/sign-in" />
  }

  if (!isAuthenticated) {
    return <CenteredStatus message="Connecting your workspace..." />
  }

  return children
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return <CenteredStatus message="Preparing authentication..." />
  }

  if (isSignedIn) {
    return <Navigate replace to="/dashboard" />
  }

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-6xl items-center justify-center">
      <div className="grid w-full grid-cols-[1.05fr_0.95fr] gap-6 overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/70 shadow-[0_32px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        <div className="flex flex-col justify-between border-r border-white/8 p-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200/72">
              Deskbinder
            </p>
            <h1 className="mt-6 max-w-md text-5xl font-semibold tracking-tight text-white">
              Keep your desk in sync with one secure account.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300/78">
              Sign in to access the local workspace shell. The dashboard is now structured around
              repositories, prompts, and future Codex job output.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-4">
            <FeatureCard
              eyebrow="Workspace"
              title="Local repo dashboard"
              text="The app now centers on repository navigation, prompt composition, and a Codex transcript shell."
            />
            <FeatureCard
              eyebrow="Security"
              title="Electron-safe boundary"
              text="Authentication stays in the renderer while privileged access remains behind preload and main."
            />
          </div>
        </div>

        <div className="flex items-center justify-center p-10">
          {mode === 'sign-in' ? (
            <SignIn
              path="/sign-in"
              routing="path"
              signUpUrl="/sign-up"
              fallback={<CenteredStatus compact message="Loading sign in..." />}
              appearance={clerkAppearance}
            />
          ) : (
            <SignUp
              path="/sign-up"
              routing="path"
              signInUrl="/sign-in"
              fallback={<CenteredStatus compact message="Loading sign up..." />}
              appearance={clerkAppearance}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function DashboardPage(): React.JSX.Element {
  return <DashboardLayout />
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
          : 'flex h-full min-h-0 items-center justify-center text-center text-sm text-slate-200/80'
      }
    >
      {message}
    </div>
  )
}

const clerkAppearance = {
  elements: {
    cardBox:
      'w-full min-w-[420px] rounded-[28px] border border-white/8 bg-white/5 shadow-none backdrop-blur',
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
