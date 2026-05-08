import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  AgentExecutable,
  CreateRepoInput,
  DesktopRepoSummary,
  RepoSettings,
  UpdateRepoInput
} from '@deskbinder/shared/deskbinder'
import { api } from '../../../../../convex/_generated/api'
import { buildRepoStateMetadata } from './repoSyncMetadata'
import type { ConvexSession } from './convexSession'

const DEFAULT_AGENT_EXECUTABLE: AgentExecutable = 'codex'
const DEFAULT_WORKSPACE_SCRIPT_PATH = 'new_workspace'
const VALID_AGENT_EXECUTABLES = new Set<AgentExecutable>(['codex', 'claude'])
const execFileAsync = promisify(execFile)

type GitCommandResult = {
  stdout: string
}

type RepoRootValidationOptions = {
  allowWorktree: boolean
  requireWorktree?: boolean
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeWorkspaceScriptPath(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim()
  return trimmed ? normalize(trimmed) : ''
}

function sanitizeAgentExecutable(value: unknown): AgentExecutable {
  if (typeof value !== 'string') {
    return DEFAULT_AGENT_EXECUTABLE
  }

  return VALID_AGENT_EXECUTABLES.has(value as AgentExecutable)
    ? (value as AgentExecutable)
    : DEFAULT_AGENT_EXECUTABLE
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const resolvedRootPath = normalize(rootPath)
  const resolvedTargetPath = normalize(targetPath)
  const relativePath = resolvedTargetPath.slice(resolvedRootPath.length)

  return (
    resolvedTargetPath === resolvedRootPath ||
    (resolvedTargetPath.startsWith(`${resolvedRootPath}/`) && relativePath.length > 0)
  )
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

async function canonicalizePath(path: string): Promise<string> {
  return normalize(await realpath(path))
}

async function resolveRepoRoot(
  repoPath: string,
  { allowWorktree, requireWorktree = false }: RepoRootValidationOptions
): Promise<string> {
  const selectedPath = await canonicalizePath(repoPath)
  const insideWorkTreeResult = await runGitCommand(selectedPath, [
    'rev-parse',
    '--is-inside-work-tree'
  ])

  if (insideWorkTreeResult.stdout.trim() !== 'true') {
    throw new Error('The selected folder is not a valid Git repository.')
  }

  const repoTopLevelResult = await runGitCommand(selectedPath, ['rev-parse', '--show-toplevel'])
  const repoRootPath = await canonicalizePath(repoTopLevelResult.stdout.trim())

  if (repoRootPath !== selectedPath) {
    throw new Error('Select the repository root folder.')
  }

  const gitDirResult = await runGitCommand(repoRootPath, ['rev-parse', '--git-dir'])
  const gitCommonDirResult = await runGitCommand(repoRootPath, ['rev-parse', '--git-common-dir'])
  const gitDirPath = await canonicalizePath(resolve(repoRootPath, gitDirResult.stdout.trim()))
  const gitCommonDirPath = await canonicalizePath(
    resolve(repoRootPath, gitCommonDirResult.stdout.trim())
  )
  const isWorktree = gitDirPath !== gitCommonDirPath

  if (!allowWorktree && isWorktree) {
    throw new Error('Add the parent repository, not a Git worktree.')
  }

  if (requireWorktree && !isWorktree) {
    throw new Error('Workspace script did not return a Git worktree.')
  }

  return repoRootPath
}

function validateRepoRelativeWorkspaceScriptPath(
  repoPath: string,
  workspaceScriptPath: string
): string {
  const normalizedWorkspaceScriptPath = sanitizeWorkspaceScriptPath(workspaceScriptPath)

  if (!normalizedWorkspaceScriptPath) {
    throw new Error('Workspace script path is required.')
  }

  if (isAbsolute(normalizedWorkspaceScriptPath)) {
    throw new Error('Workspace script path must be repo-relative.')
  }

  const normalizedRepoPath = normalize(repoPath)
  const candidatePath = normalize(resolve(normalizedRepoPath, normalizedWorkspaceScriptPath))

  if (!isPathWithin(normalizedRepoPath, candidatePath)) {
    throw new Error('Workspace script path must stay within the repo root.')
  }

  return normalizedWorkspaceScriptPath
}

export function desktopRepoToRepoSettings(repo: DesktopRepoSummary): RepoSettings {
  return {
    id: repo.localRepoId,
    name: repo.name,
    repoPath: repo.repoPath,
    workspaceScriptPath: repo.workspaceScriptPath,
    defaultScriptArgs: repo.defaultScriptArgs,
    agentExecutable: repo.agentExecutable,
    sourceRepoId: repo.sourceLocalRepoId,
    workspaceBranchName: repo.workspaceBranchName
  }
}

export class ConvexRepoStore {
  constructor(
    private readonly convexSession: ConvexSession,
    private readonly getWorkerId: () => Promise<string>
  ) {}

  async registerWorker(status: 'online' | 'busy' = 'online'): Promise<void> {
    const workerId = await this.getWorkerId()

    await this.convexSession.requireClient().mutation(api.workers.registerDesktopWorker, {
      workerId,
      name: `Deskbinder Desktop ${workerId.slice(0, 8)}`,
      status
    })
  }

  async createRepoFromFolder(input: CreateRepoInput): Promise<DesktopRepoSummary> {
    const name = sanitizeString(input.name)
    const repoPath = sanitizeString(input.repoPath)

    if (!name || !repoPath) {
      throw new Error('Invalid repo settings.')
    }

    const workerId = await this.getWorkerId()
    await this.registerWorker()
    const normalizedRepoPath = await resolveRepoRoot(repoPath, {
      allowWorktree: false
    })
    const workspaceScriptPath = validateRepoRelativeWorkspaceScriptPath(
      normalizedRepoPath,
      DEFAULT_WORKSPACE_SCRIPT_PATH
    )

    return await this.convexSession.requireClient().mutation(api.repos.createDesktopRepo, {
      workerId,
      localRepoId: randomUUID(),
      name,
      repoPath: normalizedRepoPath,
      workspaceScriptPath,
      agentExecutable: DEFAULT_AGENT_EXECUTABLE
    })
  }

  async registerWorkspaceRepo({
    sourceRepo,
    workspacePath,
    workspaceName,
    branchName
  }: {
    sourceRepo: RepoSettings
    workspacePath: string
    workspaceName?: string
    branchName?: string
  }): Promise<DesktopRepoSummary> {
    const workerId = await this.getWorkerId()
    const normalizedWorkspacePath = await resolveRepoRoot(workspacePath, {
      allowWorktree: true,
      requireWorktree: true
    })
    const workspaceScriptPath = validateRepoRelativeWorkspaceScriptPath(
      sourceRepo.repoPath,
      sourceRepo.workspaceScriptPath || DEFAULT_WORKSPACE_SCRIPT_PATH
    )

    return await this.convexSession.requireClient().mutation(api.repos.createDesktopRepo, {
      workerId,
      localRepoId: randomUUID(),
      sourceLocalRepoId: sourceRepo.id,
      name: sanitizeString(workspaceName) ?? basename(normalizedWorkspacePath),
      repoPath: normalizedWorkspacePath,
      workspaceScriptPath,
      defaultScriptArgs: sourceRepo.defaultScriptArgs,
      agentExecutable: sourceRepo.agentExecutable ?? DEFAULT_AGENT_EXECUTABLE,
      workspaceBranchName: branchName
    })
  }

  async updateRepoSettings(input: UpdateRepoInput): Promise<DesktopRepoSummary> {
    const localRepoId = sanitizeString(input.localRepoId ?? input.id)
    const name = sanitizeString(input.name)
    const workspaceScriptPath = sanitizeWorkspaceScriptPath(input.workspaceScriptPath)

    if (!localRepoId || !name || !workspaceScriptPath) {
      throw new Error('Invalid repo settings.')
    }

    const repo = await this.getRepoSummary(localRepoId)
    const validatedWorkspaceScriptPath = validateRepoRelativeWorkspaceScriptPath(
      repo.repoPath,
      workspaceScriptPath
    )

    return await this.convexSession.requireClient().mutation(api.repos.updateDesktopRepoSettings, {
      workerId: await this.getWorkerId(),
      localRepoId,
      name,
      workspaceScriptPath: validatedWorkspaceScriptPath,
      defaultScriptArgs: sanitizeString(input.defaultScriptArgs) ?? undefined,
      agentExecutable: sanitizeAgentExecutable(input.agentExecutable)
    })
  }

  async listRepos(): Promise<DesktopRepoSummary[]> {
    return await this.convexSession.requireClient().query(api.repos.listDesktopRepos, {
      workerId: await this.getWorkerId()
    })
  }

  async getRepoSummary(localRepoId: string): Promise<DesktopRepoSummary> {
    return await this.convexSession
      .requireClient()
      .query(api.repos.getDesktopRepoConfigForExecution, {
        workerId: await this.getWorkerId(),
        localRepoId
      })
  }

  async getRepoForExecution(localRepoId: string): Promise<RepoSettings> {
    return desktopRepoToRepoSettings(await this.getRepoSummary(localRepoId))
  }

  async syncRepoStates(): Promise<DesktopRepoSummary[]> {
    const workerId = await this.getWorkerId()
    await this.registerWorker()
    const repos = await this.listRepos()
    const repoStates = await buildRepoStateMetadata({ repos })

    return await this.convexSession.requireClient().mutation(api.repos.syncDesktopRepoStates, {
      workerId,
      repos: repoStates
    })
  }

  async softDeleteRepo(localRepoId: string): Promise<DesktopRepoSummary> {
    return await this.convexSession.requireClient().mutation(api.repos.softDeleteDesktopRepo, {
      workerId: await this.getWorkerId(),
      localRepoId
    })
  }

  async updateWorkerSettings(autoRunEnabled: boolean): Promise<{ autoRunEnabled: boolean }> {
    const workerId = await this.getWorkerId()
    const worker = await this.convexSession
      .requireClient()
      .mutation(api.workers.updateDesktopWorkerSettings, {
        workerId,
        autoRunEnabled
      })

    return {
      autoRunEnabled: worker.autoRunEnabled
    }
  }
}
