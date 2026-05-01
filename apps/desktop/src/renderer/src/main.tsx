import './assets/main.css'

import { ClerkProvider } from '@clerk/react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import App from './App'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const convexUrl = import.meta.env.VITE_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

type RendererErrorBoundaryProps = {
  children: ReactNode
}

type RendererErrorBoundaryState = {
  error: Error | null
}

class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = {
    error: null
  }

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Renderer crashed', error, errorInfo)
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="flex h-dvh items-center justify-center overflow-hidden bg-[#061018] px-6 text-slate-100">
          <section className="w-full max-w-2xl rounded-[28px] border border-rose-300/20 bg-rose-300/10 p-8 shadow-2xl backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-rose-200/80">
              Renderer Error
            </p>
            <h1 className="mt-4 text-3xl font-semibold text-white">
              The app hit an unexpected renderer error.
            </h1>
            <p className="mt-4 text-sm leading-6 text-slate-200/80">
              Reload the window or restart the app. The error is shown below so the failure no
              longer collapses into a blank screen.
            </p>
            <pre className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/72 p-4 text-xs leading-6 text-slate-200">
              {this.state.error.message}
            </pre>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RendererErrorBoundary>
      {publishableKey && convex ? (
        <ClerkProvider publishableKey={publishableKey}>
          <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ConvexProviderWithClerk>
        </ClerkProvider>
      ) : (
        <App />
      )}
    </RendererErrorBoundary>
  </StrictMode>
)
