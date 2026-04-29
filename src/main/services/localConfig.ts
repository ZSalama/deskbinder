import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { App } from 'electron'
import type {
  CreateRepoInput,
  DeskbinderConfig,
  LocalJobIndex,
  RepoSettings
} from '../../shared/deskbinder'

const CONFIG_FILENAME = 'deskbinder.json'
const DEFAULT_AGENT_EXECUTABLE = 'codex'
const execFileAsync = promisify(execFile)

type GitCommandResult = {
  stdout: string
}

async function runGitCommand(cwd: string, args: string[]): Promise<GitCommandResult> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    })

    return { stdout }
  } catch {
    throw new Error('The selected folder is not a valid Git repository.')
  }
}

function createDefaultConfig(): DeskbinderConfig {
  return {
    workerId: randomUUID(),
    repos: [],
    jobs: [],
    appSettings: {
      autoRunEnabled: false
    }
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

async function canonicalizePath(path: string): Promise<string> {
  return normalize(await realpath(path))
}

async function resolveValidatedRepoRoot(repoPath: string): Promise<string> {
  const selectedPath = await canonicalizePath(repoPath)
  const insideWorkTreeResult = await runGitCommand(selectedPath, ['rev-parse', '--is-inside-work-tree'])

  if (insideWorkTreeResult.stdout.trim() !== 'true') {
    throw new Error('The selected folder is not a valid Git repository.')
  }

  const repoTopLevelResult = await runGitCommand(selectedPath, ['rev-parse', '--show-toplevel'])
  const repoRootPath = await canonicalizePath(repoTopLevelResult.stdout.trim())

  if (repoRootPath !== selectedPath) {
    throw new Error('Pick the repository root folder, not a subdirectory inside the repo.')
  }

  await runGitCommand(repoRootPath, ['branch', '--show-current'])

  const statusResult = await runGitCommand(repoRootPath, ['status', '--porcelain'])

  if (statusResult.stdout.trim().length > 0) {
    throw new Error('This repository has uncommitted or untracked changes. Commit or stash them before adding it.')
  }

  const gitDirResult = await runGitCommand(repoRootPath, ['rev-parse', '--git-dir'])
  const gitCommonDirResult = await runGitCommand(repoRootPath, ['rev-parse', '--git-common-dir'])
  const gitDirPath = await canonicalizePath(resolve(repoRootPath, gitDirResult.stdout.trim()))
  const gitCommonDirPath = await canonicalizePath(resolve(repoRootPath, gitCommonDirResult.stdout.trim()))

  if (gitDirPath !== gitCommonDirPath) {
    throw new Error('Git worktrees cannot be added as repos. Add the primary repository instead.')
  }

  return repoRootPath
}

function sanitizeRepoSettings(value: unknown): RepoSettings | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const id = sanitizeString(record.id)
  const name = sanitizeString(record.name)
  const repoPath = sanitizeString(record.repoPath)

  if (!id || !name || !repoPath) {
    return null
  }

  const workspaceScriptPathValue = record.workspaceScriptPath
  const workspaceScriptPath =
    typeof workspaceScriptPathValue === 'string' ? normalizeOptionalPath(workspaceScriptPathValue) : ''
  const defaultScriptArgs =
    typeof record.defaultScriptArgs === 'string' && record.defaultScriptArgs.trim().length > 0
      ? record.defaultScriptArgs.trim()
      : undefined
  const agentExecutable =
    typeof record.agentExecutable === 'string' && record.agentExecutable.trim().length > 0
      ? record.agentExecutable.trim()
      : undefined

  return {
    id,
    name,
    repoPath: normalizeOptionalPath(repoPath),
    workspaceScriptPath,
    defaultScriptArgs,
    agentExecutable
  }
}

function sanitizeJobIndex(value: unknown): LocalJobIndex | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const id = sanitizeString(record.id)
  const repoId = sanitizeString(record.repoId)
  const status = sanitizeString(record.status)
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : null
  const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : null

  if (!id || !repoId || !status || createdAt === null || updatedAt === null) {
    return null
  }

  return {
    id,
    repoId,
    status: status as LocalJobIndex['status'],
    branchName: typeof record.branchName === 'string' ? record.branchName : undefined,
    createdAt,
    updatedAt
  }
}

function sanitizeConfig(value: unknown): DeskbinderConfig {
  if (!value || typeof value !== 'object') {
    return createDefaultConfig()
  }

  const record = value as Record<string, unknown>
  const workerId = sanitizeString(record.workerId) ?? randomUUID()
  const repos = Array.isArray(record.repos)
    ? record.repos
        .map(sanitizeRepoSettings)
        .filter((repo): repo is RepoSettings => repo !== null)
    : []
  const jobs = Array.isArray(record.jobs)
    ? record.jobs
        .map(sanitizeJobIndex)
        .filter((job): job is LocalJobIndex => job !== null)
    : []
  const appSettingsRecord =
    record.appSettings && typeof record.appSettings === 'object'
      ? (record.appSettings as Record<string, unknown>)
      : null

  return {
    workerId,
    repos,
    jobs,
    appSettings: {
      autoRunEnabled:
        appSettingsRecord && typeof appSettingsRecord.autoRunEnabled === 'boolean'
          ? appSettingsRecord.autoRunEnabled
          : false
    }
  }
}

export class LocalConfigStore {
  private readonly configPath: string

  constructor(app: App) {
    this.configPath = resolve(app.getPath('userData'), CONFIG_FILENAME)
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
      const errorCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : null

      if (errorCode === 'ENOENT') {
        const config = createDefaultConfig()
        await this.write(config)
        return config
      }

      throw new Error('Unable to load local config.')
    }
  }

  async upsertRepo(repo: RepoSettings): Promise<DeskbinderConfig> {
    const sanitizedRepo = sanitizeRepoSettings(repo)

    if (!sanitizedRepo) {
      throw new Error('Invalid repo settings.')
    }

    const currentConfig = await this.read()
    const nextRepos = currentConfig.repos.some((currentRepo) => currentRepo.id === sanitizedRepo.id)
      ? currentConfig.repos.map((currentRepo) =>
          currentRepo.id === sanitizedRepo.id ? sanitizedRepo : currentRepo
        )
      : [...currentConfig.repos, sanitizedRepo]

    const nextConfig = {
      ...currentConfig,
      repos: nextRepos
    }

    await this.write(nextConfig)
    return nextConfig
  }

  async createRepo(input: CreateRepoInput): Promise<DeskbinderConfig> {
    const name = sanitizeString(input.name)
    const repoPath = sanitizeString(input.repoPath)

    if (!name || !repoPath) {
      throw new Error('Invalid repo settings.')
    }

    const normalizedRepoPath = await resolveValidatedRepoRoot(repoPath)
    const currentConfig = await this.read()
    const existingRepo = currentConfig.repos.find((repo) => repo.repoPath === normalizedRepoPath)

    if (existingRepo) {
      throw new Error('This repository is already configured in deskbinder.')
    }

    const nextConfig = {
      ...currentConfig,
      repos: [
        ...currentConfig.repos,
        {
          id: randomUUID(),
          name,
          repoPath: normalizedRepoPath,
          workspaceScriptPath: '',
          agentExecutable: DEFAULT_AGENT_EXECUTABLE
        }
      ]
    }

    await this.write(nextConfig)
    return nextConfig
  }

  async updateAppSettings(autoRunEnabled: boolean): Promise<DeskbinderConfig> {
    const currentConfig = await this.read()
    const nextConfig = {
      ...currentConfig,
      appSettings: {
        ...currentConfig.appSettings,
        autoRunEnabled
      }
    }

    await this.write(nextConfig)
    return nextConfig
  }

  private async write(config: DeskbinderConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })

    const tempPath = `${this.configPath}.tmp`
    const contents = `${JSON.stringify(config, null, 2)}\n`

    await writeFile(tempPath, contents, 'utf8')
    await rename(tempPath, this.configPath)
  }
}
