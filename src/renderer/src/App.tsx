import { useEffect, useState } from 'react'
import Versions from './components/Versions'
import electronLogo from './assets/electron.svg'
import wavyLines from './assets/wavy-lines.svg'
import type { AppVersions } from '../../shared/ipc'

function App(): React.JSX.Element {
  const [versions, setVersions] = useState<AppVersions | null>(null)
  const [pingState, setPingState] = useState('Send IPC')

  useEffect(() => {
    let isMounted = true

    void window.api.getVersions().then((nextVersions) => {
      if (isMounted) {
        setVersions(nextVersions)
      }
    })

    return () => {
      isMounted = false
    }
  }, [])

  const ipcHandle = async (): Promise<void> => {
    const result = await window.api.ping()
    setPingState(result)
  }

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-6 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(8,126,164,0.22),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(49,120,198,0.22),transparent_26%),linear-gradient(180deg,rgba(10,14,22,0.7),rgba(12,17,27,0.92))]" />
      <div
        className="absolute inset-0 bg-cover bg-center opacity-35"
        style={{ backgroundImage: `url(${wavyLines})` }}
      />

      <section className="relative z-10 flex w-full max-w-3xl flex-col items-center rounded-[2rem] border border-white/10 bg-white/6 px-8 py-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:px-12">
        <img
          alt="logo"
          className="mb-6 h-24 w-24 select-none transition duration-300 hover:drop-shadow-[0_0_1.2em_rgba(105,136,230,0.66)] sm:h-32 sm:w-32"
          src={electronLogo}
        />
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.35em] text-white/55">
          Powered by electron-vite
        </div>
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          Build an Electron app with{' '}
          <span className="bg-linear-[315deg,#087ea4_55%,#7c93ee] bg-clip-text text-transparent">
            React
          </span>{' '}
          and{' '}
          <span className="bg-linear-[315deg,#3178c6_45%,#f0dc4e] bg-clip-text text-transparent">
            TypeScript
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-sm leading-6 text-white/70 sm:text-base">
          Press <code>F12</code> to open the developer tools and inspect the renderer.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            className="rounded-full border border-white/12 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/16"
            href="https://electron-vite.org/"
            target="_blank"
            rel="noreferrer"
          >
            Documentation
          </a>
          <button
            type="button"
            className="cursor-pointer rounded-full border border-cyan-300/20 bg-cyan-400/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/30 hover:bg-cyan-300/16"
            onClick={ipcHandle}
          >
            {pingState}
          </button>
        </div>
        <Versions versions={versions} />
      </section>
    </main>
  )
}

export default App
