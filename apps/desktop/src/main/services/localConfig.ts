import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { App } from 'electron'
import type {
  DeskbinderConfig,
  LocalDeviceConfig,
  TrackedWorkspace,
  TrackedWorkspaceProcess
} from '@deskbinder/shared/deskbinder'

const CONFIG_FILENAME = 'deskbinder.json'
const DEV_CONFIG_DIRECTORY = '.deskbinder'

function createDefaultConfig(): DeskbinderConfig {
  return {
    workerId: randomUUID(),
    trackedWorkspaces: []
  }
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalPath(value: string | undefined): string {
  if (!value) {
    return ''
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  return normalize(isAbsolute(trimmed) ? trimmed : resolve(trimmed))
}

function sanitizeTrackedWorkspaceProcesses(value: unknown): TrackedWorkspaceProcess[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const nextValues = value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => {
      const pid = entry.pid
      const startTimeTicks = entry.startTimeTicks
      const cwdPath = sanitizeString(entry.cwdPath)

      if (
        typeof pid !== 'number' ||
        !Number.isInteger(pid) ||
        pid <= 1 ||
        typeof startTimeTicks !== 'number' ||
        !Number.isFinite(startTimeTicks) ||
        startTimeTicks <= 0
      ) {
        return null
      }

      const nextValue: TrackedWorkspaceProcess = {
        pid,
        startTimeTicks
      }

      if (cwdPath) {
        nextValue.cwdPath = normalizeOptionalPath(cwdPath)
      }

      return nextValue
    })
    .filter((entry): entry is TrackedWorkspaceProcess => entry !== null)

  return nextValues.length > 0 ? nextValues : undefined
}

function sanitizeTrackedWorkspace(value: unknown): TrackedWorkspace | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const repoId = sanitizeString(record.repoId)
  const repoPath = normalizeOptionalPath(sanitizeString(record.repoPath) ?? undefined)
  const sourceRepoPath = normalizeOptionalPath(sanitizeString(record.sourceRepoPath) ?? undefined)
  const workspaceBranchName = sanitizeString(record.workspaceBranchName) ?? undefined
  const workspaceProcesses = sanitizeTrackedWorkspaceProcesses(record.workspaceProcesses)

  if (!repoId || !repoPath) {
    return null
  }

  return {
    repoId,
    repoPath,
    sourceRepoPath: sourceRepoPath || undefined,
    workspaceBranchName,
    workspaceProcesses
  }
}

function sanitizeConfig(value: unknown): DeskbinderConfig {
  if (!value || typeof value !== 'object') {
    return createDefaultConfig()
  }

  const record = value as Record<string, unknown>
  const workerId = sanitizeString(record.workerId) ?? randomUUID()
  const trackedWorkspaces = Array.isArray(record.trackedWorkspaces)
    ? record.trackedWorkspaces
        .map(sanitizeTrackedWorkspace)
        .filter((workspace): workspace is TrackedWorkspace => workspace !== null)
    : []

  return {
    workerId,
    trackedWorkspaces
  }
}

function resolveConfigPath(app: App): string {
  if (!app.isPackaged) {
    return resolve(app.getAppPath(), DEV_CONFIG_DIRECTORY, CONFIG_FILENAME)
  }

  return resolve(app.getPath('userData'), CONFIG_FILENAME)
}

export class LocalConfigStore {
  private readonly configPath: string

  constructor(app: App) {
    this.configPath = resolveConfigPath(app)
  }

  async read(): Promise<DeskbinderConfig> {
    try {
      const rawConfig = await readFile(this.configPath, 'utf8')
      const config = sanitizeConfig(JSON.parse(rawConfig))

      if (rawConfig !== JSON.stringify(config, null, 2) + '\n') {
        await this.write(config)
      }

      return config
    } catch (error) {
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : null

      if (errorCode === 'ENOENT') {
        const config = createDefaultConfig()
        await this.write(config)
        return config
      }

      throw new Error('Unable to load local config.')
    }
  }

  async readDeviceConfig(): Promise<LocalDeviceConfig> {
    const config = await this.read()

    return {
      workerId: config.workerId
    }
  }

  async trackWorkspace(workspace: TrackedWorkspace): Promise<DeskbinderConfig> {
    const currentConfig = await this.read()
    const sanitizedWorkspace = sanitizeTrackedWorkspace(workspace)

    if (!sanitizedWorkspace) {
      throw new Error('Invalid workspace tracking metadata.')
    }

    const existingWorkspace = currentConfig.trackedWorkspaces.find(
      (currentWorkspace) => currentWorkspace.repoId === sanitizedWorkspace.repoId
    )
    const trackedWorkspaces = existingWorkspace
      ? currentConfig.trackedWorkspaces.map((currentWorkspace) =>
          currentWorkspace.repoId === sanitizedWorkspace.repoId
            ? sanitizedWorkspace
            : currentWorkspace
        )
      : [...currentConfig.trackedWorkspaces, sanitizedWorkspace]
    const nextConfig = {
      ...currentConfig,
      trackedWorkspaces
    }

    await this.write(nextConfig)
    return nextConfig
  }

  async forgetTrackedWorkspace(repoId: string): Promise<DeskbinderConfig> {
    const sanitizedRepoId = sanitizeString(repoId)

    if (!sanitizedRepoId) {
      return this.read()
    }

    const currentConfig = await this.read()
    const nextConfig = {
      ...currentConfig,
      trackedWorkspaces: currentConfig.trackedWorkspaces.filter(
        (workspace) => workspace.repoId !== sanitizedRepoId
      )
    }

    await this.write(nextConfig)
    return nextConfig
  }

  async clearWorkspaceProcesses(repoIds: string[]): Promise<DeskbinderConfig> {
    if (repoIds.length === 0) {
      return this.read()
    }

    const targetRepoIds = new Set(repoIds)
    const currentConfig = await this.read()
    const nextConfig = {
      ...currentConfig,
      trackedWorkspaces: currentConfig.trackedWorkspaces.map((workspace) =>
        targetRepoIds.has(workspace.repoId)
          ? { ...workspace, workspaceProcesses: undefined }
          : workspace
      )
    }

    await this.write(nextConfig)
    return nextConfig
  }

  private async write(config: DeskbinderConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })

    const tempPath = `${this.configPath}.${randomUUID()}.tmp`
    const contents = `${JSON.stringify(config, null, 2)}\n`

    await writeFile(tempPath, contents, 'utf8')
    await rename(tempPath, this.configPath)
  }
}
