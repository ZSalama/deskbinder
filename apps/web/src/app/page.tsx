import { ConvexStatusCard } from '../components/convex-status-card'

export default function HomePage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-10 sm:px-10">
      <section className="grid w-full gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[2.5rem] border border-white/10 bg-slate-950/58 p-8 shadow-[0_32px_120px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200/72">
            Deskbinder
          </p>
          <h1 className="mt-5 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
            Simple web login and dashboard.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-8 text-slate-300/82">
            Sign in with Clerk, resolve the session through Convex, and show the current user in a
            minimal dashboard.
          </p>
        </article>

        <article className="rounded-[2.5rem] border border-white/10 bg-slate-950/58 p-8 shadow-[0_32px_120px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-10">
          <ConvexStatusCard />
        </article>
      </section>
    </main>
  )
}
