import { ConvexStatusCard } from '../components/convex-status-card'

export default function HomePage(): React.JSX.Element {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#070b12] text-slate-100">
      <div className="fixed inset-0 bg-[linear-gradient(135deg,#111923_0%,#090e15_46%,#05070b_100%)]" />
      <div className="fixed inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.026)_1px,transparent_1px)] bg-[size:80px_80px] opacity-20" />

      <section className="relative z-10 min-h-dvh">
        <ConvexStatusCard />
      </section>
    </main>
  )
}
