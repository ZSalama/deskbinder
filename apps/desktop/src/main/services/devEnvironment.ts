import { createConnection } from 'node:net'
import type {
  DesktopRepoSummary,
  DevEnvironmentStatus,
  OpenDevEnvironmentResponse
} from '@deskbinder/shared/deskbinder'
import type { ConvexRepoStore } from './convexRepoStore'
import type { LocalConfigStore } from './localConfig'
import { isTrackedWorkspaceProcessLive } from './processTracking'

const LOCALHOST_HOST = '127.0.0.1'
const LOCALHOST_DISPLAY_HOST = 'localhost'
const PORT_CONNECT_TIMEOUT_MS = 750

type DevEnvironmentServiceOptions = {
  convexRepoStore: ConvexRepoStore
  localConfigStore: LocalConfigStore
}

type OpenDevEnvironmentOptions = DevEnvironmentServiceOptions & {
  openExternal: (url: string) => Promise<void>
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}

function buildDevEnvironmentUrl(port: number): string {
  return `http://${LOCALHOST_DISPLAY_HOST}:${port}/`
}

function canConnectToPort(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = createConnection({
      host: LOCALHOST_HOST,
      port
    })
    let settled = false

    const finish = (isAvailable: boolean): void => {
      if (settled) {
        return
      }

      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolvePort(isAvailable)
    }

    socket.unref()
    socket.setTimeout(PORT_CONNECT_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

export async function getDevEnvironmentStatus(
  input: { repoId: string },
  { convexRepoStore, localConfigStore }: DevEnvironmentServiceOptions
): Promise<DevEnvironmentStatus> {
  const repoId = input.repoId.trim()

  if (!repoId) {
    return {
      running: false,
      repoId,
      reason: 'repo_unavailable'
    }
  }

  let repo: DesktopRepoSummary

  try {
    repo = await convexRepoStore.getRepoSummary(repoId)
  } catch {
    return {
      running: false,
      repoId,
      reason: 'repo_unavailable'
    }
  }

  const trackedWorkspace = (await localConfigStore.read()).trackedWorkspaces.find(
    (workspace) => workspace.repoId === repoId
  )
  const devEnvironment = trackedWorkspace?.devEnvironment
  const pid = devEnvironment?.process.pid

  if (!devEnvironment) {
    return {
      running: false,
      repoId,
      reason: 'not_configured'
    }
  }

  if (!isValidPort(devEnvironment.port)) {
    return {
      running: false,
      repoId,
      pid,
      reason: 'invalid_port'
    }
  }

  const isProcessLive = await isTrackedWorkspaceProcessLive(repo.repoPath, devEnvironment.process)

  if (!isProcessLive) {
    return {
      running: false,
      repoId,
      port: devEnvironment.port,
      pid,
      reason: 'process_exited'
    }
  }

  if (!(await canConnectToPort(devEnvironment.port))) {
    return {
      running: false,
      repoId,
      port: devEnvironment.port,
      pid,
      reason: 'port_unavailable'
    }
  }

  return {
    running: true,
    repoId,
    port: devEnvironment.port,
    pid: devEnvironment.process.pid,
    url: buildDevEnvironmentUrl(devEnvironment.port)
  }
}

export async function openDevEnvironment(
  input: { repoId: string },
  options: OpenDevEnvironmentOptions
): Promise<OpenDevEnvironmentResponse> {
  const status = await getDevEnvironmentStatus(input, options)

  if (!status.running) {
    return {
      ok: false,
      errorMessage: 'Dev server is not running.',
      status
    }
  }

  try {
    await options.openExternal(status.url)
  } catch {
    return {
      ok: false,
      errorMessage: 'Unable to open the dev server in the default browser.',
      status
    }
  }

  return {
    ok: true,
    url: status.url,
    port: status.port,
    pid: status.pid
  }
}
