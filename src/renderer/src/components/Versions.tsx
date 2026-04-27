import type { AppVersions } from '../../../shared/ipc'

interface VersionsProps {
  versions: AppVersions | null
}

function Versions({ versions }: VersionsProps): React.JSX.Element | null {
  if (!versions) {
    return null
  }

  return (
    <ul className="mt-8 hidden overflow-hidden rounded-full border border-white/10 bg-black/30 font-mono text-xs text-white/75 backdrop-blur-xl sm:inline-flex">
      <li className="border-r border-white/10 px-4 py-3">Electron v{versions.electron}</li>
      <li className="border-r border-white/10 px-4 py-3">Chromium v{versions.chrome}</li>
      <li className="px-4 py-3">Node v{versions.node}</li>
    </ul>
  )
}

export default Versions
