import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import { isAbsolute, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  DeskbinderConfig,
  DesktopRepoSummary,
  RepoReadinessStatus,
  RepoSettings,
  RepoSyncMetadata,
  RepoSyncMetadataResponse
} from '@deskbinder/shared/deskbinder'

const execFileAsync = promisify(execFile)

type GitCommandResult = {
  stdout: string
}

type RepoReadinessResult = {
  currentBranch: string
  readinessStatus: RepoReadinessStatus
  readinessMessage?: string
}

async function runGitCommand(cwd: string, args: string[]): Promise<GitCommandResult> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  })

  return { stdout }
}

async function canonicalizePath(path: string): Promise<string> {
  return normalize(await realpath(path))
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

function createReadinessResult(
  readinessStatus: RepoReadinessStatus,
  readinessMessage?: string,
  currentBranch = ''
): RepoReadinessResult {
  return {
    currentBranch,
    readinessStatus,
    readinessMessage
  }
}

function isRunnableReadinessStatus(readinessStatus: RepoReadinessStatus): boolean {
  return readinessStatus === 'ready' || readinessStatus === 'dirty'
}

async function validateWorkspaceScript(
  repoPath: string,
  workspaceScriptPath: string
): Promise<void> {
  const trimmedScriptPath = workspaceScriptPath.trim()

  if (!trimmedScriptPath || isAbsolute(trimmedScriptPath)) {
    throw new Error('missing_script')
  }

  const normalizedRepoPath = await canonicalizePath(repoPath)
  const candidatePath = normalize(resolve(normalizedRepoPath, trimmedScriptPath))
  const resolvedScriptPath = normalize(await realpath(candidatePath))

  if (!isPathWithin(normalizedRepoPath, resolvedScriptPath)) {
    throw new Error('missing_script')
  }

  await access(resolvedScriptPath, constants.X_OK)
}

async function getCurrentBranch(repoPath: string): Promise<string> {
  const branchResult = await runGitCommand(repoPath, ['branch', '--show-current'])

  return branchResult.stdout.trim()
}

async function inspectRepoReadiness(repo: RepoSettings): Promise<RepoReadinessResult> {
  const isWorkspace = Boolean(repo.sourceRepoId)
  let repoPath: string

  try {
    repoPath = await canonicalizePath(repo.repoPath)
  } catch {
    return createReadinessResult('missing_repo', 'Local repository folder is missing.')
  }

  let currentBranch = ''

  try {
    const insideWorkTreeResult = await runGitCommand(repoPath, [
      'rev-parse',
      '--is-inside-work-tree'
    ])

    if (insideWorkTreeResult.stdout.trim() !== 'true') {
      return createReadinessResult('invalid', 'Local repository is not a valid Git work tree.')
    }

    const repoTopLevelResult = await runGitCommand(repoPath, ['rev-parse', '--show-toplevel'])
    const repoRootPath = await canonicalizePath(repoTopLevelResult.stdout.trim())

    if (repoRootPath !== repoPath) {
      return createReadinessResult('invalid', 'Local repository must be configured at its root.')
    }

    currentBranch = await getCurrentBranch(repoPath)

    const gitDirResult = await runGitCommand(repoPath, ['rev-parse', '--git-dir'])
    const gitCommonDirResult = await runGitCommand(repoPath, ['rev-parse', '--git-common-dir'])
    const gitDirPath = await canonicalizePath(resolve(repoPath, gitDirResult.stdout.trim()))
    const gitCommonDirPath = await canonicalizePath(
      resolve(repoPath, gitCommonDirResult.stdout.trim())
    )

    if (gitDirPath !== gitCommonDirPath && !isWorkspace) {
      return createReadinessResult(
        'invalid',
        'Local repository is a Git worktree. Select the primary repository instead.',
        currentBranch
      )
    }

    const statusResult = await runGitCommand(repoPath, ['status', '--porcelain'])
    const hasLocalChanges = statusResult.stdout.trim().length > 0

    if (!isWorkspace) {
      try {
        await validateWorkspaceScript(repoPath, repo.workspaceScriptPath)
      } catch {
        return createReadinessResult(
          'missing_script',
          'Workspace bootstrap script is missing or not executable.',
          currentBranch
        )
      }
    }

    if (hasLocalChanges) {
      return createReadinessResult('dirty', 'Working tree has local changes.', currentBranch)
    }
  } catch {
    return createReadinessResult(
      'invalid',
      'Local repository could not be validated as a Git repository.',
      currentBranch
    )
  }

  return createReadinessResult('ready', 'Ready for cloud jobs.', currentBranch)
}

export async function buildRepoSyncMetadata(
  config: DeskbinderConfig
): Promise<RepoSyncMetadataResponse> {
  const lastSeenAt = Date.now()
  const activeRepos = config.repos.filter((repo) => !repo.deleted)
  const repos = await Promise.all(
    activeRepos.map(async (repo): Promise<RepoSyncMetadata> => {
      const readiness = await inspectRepoReadiness(repo)

      return {
        localRepoId: repo.id,
        sourceLocalRepoId: repo.sourceRepoId,
        name: repo.name,
        currentBranch: readiness.currentBranch,
        workspaceBranchName: repo.workspaceBranchName,
        isValid: isRunnableReadinessStatus(readiness.readinessStatus),
        readinessStatus: readiness.readinessStatus,
        readinessMessage: readiness.readinessMessage,
        workerId: config.workerId,
        lastSeenAt
      }
    })
  )

  return {
    workerId: config.workerId,
    repos
  }
}

export async function buildRepoStateMetadata({
  repos
}: {
  repos: DesktopRepoSummary[]
}): Promise<
  Array<{
    localRepoId: string
    currentBranch: string
    isValid: boolean
    readinessStatus: RepoReadinessStatus
    readinessMessage?: string
    lastSeenAt: number
  }>
> {
  const lastSeenAt = Date.now()

  return await Promise.all(
    repos.map(async (repo) => {
      const readiness = await inspectRepoReadiness({
        id: repo.localRepoId,
        name: repo.name,
        repoPath: repo.repoPath,
        workspaceScriptPath: repo.workspaceScriptPath,
        defaultScriptArgs: repo.defaultScriptArgs,
        agentExecutable: repo.agentExecutable,
        sourceRepoId: repo.sourceLocalRepoId,
        workspaceBranchName: repo.workspaceBranchName
      })

      return {
        localRepoId: repo.localRepoId,
        currentBranch: readiness.currentBranch,
        isValid: isRunnableReadinessStatus(readiness.readinessStatus),
        readinessStatus: readiness.readinessStatus,
        readinessMessage: readiness.readinessMessage,
        lastSeenAt
      }
    })
  )
}
