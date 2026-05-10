import { ConvexStatusCard } from '../components/convex-status-card'

export default function HomePage(): React.JSX.Element {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#080d14] text-slate-100">
      <section className="min-h-dvh">
        <ConvexStatusCard />
      </section>
    </main>
  )
}
