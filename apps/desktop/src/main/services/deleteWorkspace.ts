import { execFile } from 'node:child_process'
import { realpath, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { DeleteWorkspaceResponse, RepoSettings } from '@deskbinder/shared/deskbinder'
import { LocalConfigStore } from './localConfig'
import { terminateTrackedWorkspaceProcesses } from './processTracking'

const execFileAsync = promisify(execFile)
const GIT_BUFFER_BYTES = 1024 * 1024

type WorktreeDetails = {
  branchName: string | null
  repoPath: string
  sourceRepoPath: string
}

type WorktreeEntry = {
  branchName: string | null
  worktreePath: string
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizePath(path: string): string {
  return normalize(isAbsolute(path) ? path : resolve(path))
}

function trimGitOutput(value: string): string {
  return value.trim()
}

function stripBranchRef(branchRef: string): string {
  return branchRef.startsWith('refs/heads/') ? branchRef.slice('refs/heads/'.length) : branchRef
}

function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  const blocks = stdout
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.length > 0)

  for (const block of blocks) {
    let worktreePath: string | null = null
    let branchName: string | null = null

    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) {
        worktreePath = normalizePath(line.slice('worktree '.length))
        continue
      }

      if (line.startsWith('branch ')) {
        branchName = stripBranchRef(line.slice('branch '.length).trim())
      }
    }

    if (worktreePath) {
      entries.push({
        worktreePath,
        branchName
      })
    }
  }

  return entries
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: GIT_BUFFER_BYTES
  })

  return trimGitOutput(stdout)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await realpath(path)
    return true
  } catch {
    return false
  }
}

async function inspectWorktreeRepo(repoPath: string): Promise<WorktreeDetails | null> {
  try {
    const resolvedRepoPath = normalize(await realpath(repoPath))
    const topLevel = normalize(
      await runGitCommand(resolvedRepoPath, ['rev-parse', '--show-toplevel'])
    )

    if (topLevel !== resolvedRepoPath) {
      return null
    }

    const gitDir = normalize(
      await runGitCommand(resolvedRepoPath, ['rev-parse', '--path-format=absolute', '--git-dir'])
    )
    const gitCommonDir = normalize(
      await runGitCommand(resolvedRepoPath, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir'
      ])
    )

    if (gitDir === gitCommonDir) {
      return null
    }

    const branchName = sanitizeString(
      await runGitCommand(resolvedRepoPath, ['branch', '--show-current'])
    )

    return {
      repoPath: topLevel,
      sourceRepoPath: dirname(gitCommonDir),
      branchName
    }
  } catch {
    return null
  }
}

async function validateSourceRepoPath(sourceRepoPath: string): Promise<string> {
  const resolvedSourceRepoPath = normalize(await realpath(sourceRepoPath))
  const topLevel = normalize(
    await runGitCommand(resolvedSourceRepoPath, ['rev-parse', '--show-toplevel'])
  )

  if (topLevel !== resolvedSourceRepoPath) {
    throw new Error('Workspace source repository metadata is invalid.')
  }

  return resolvedSourceRepoPath
}

async function findWorktreeEntry(
  sourceRepoPath: string,
  worktreePath: string
): Promise<WorktreeEntry | null> {
  try {
    const entries = parseWorktreeList(
      await runGitCommand(sourceRepoPath, ['worktree', 'list', '--porcelain'])
    )
    const normalizedWorktreePath = normalizePath(worktreePath)

    return entries.find((entry) => entry.worktreePath === normalizedWorktreePath) ?? null
  } catch {
    return null
  }
}

async function validateBranchName(sourceRepoPath: string, branchName: string): Promise<string> {
  await runGitCommand(sourceRepoPath, ['check-ref-format', '--branch', branchName])
  return branchName
}

function selectNextRepoId(currentRepos: RepoSettings[], preferredRepoId?: string): string | null {
  const visibleRepos = currentRepos.filter((repo) => !repo.deleted)

  if (preferredRepoId && visibleRepos.some((repo) => repo.id === preferredRepoId)) {
    return preferredRepoId
  }

  return visibleRepos[0]?.id ?? null
}

export async function deleteWorkspace({
  localConfigStore,
  repoId
}: {
  localConfigStore: LocalConfigStore
  repoId: string
}): Promise<DeleteWorkspaceResponse> {
  const currentConfig = await localConfigStore.read()
  const repo = currentConfig.repos.find((currentRepo) => currentRepo.id === repoId)

  if (!repo) {
    throw new Error('Selected workspace is no longer configured.')
  }

  return await deleteWorkspaceForRepo({
    repo,
    softDeleteRepo: async () => {
      const nextConfig = await localConfigStore.softDeleteRepo(repo.id)

      return {
        config: nextConfig,
        selectedRepoId: selectNextRepoId(nextConfig.repos, repo.sourceRepoId)
      }
    }
  })
}

export async function deleteWorkspaceForRepo({
  repo,
  softDeleteRepo
}: {
  repo: RepoSettings
  softDeleteRepo: () => Promise<{
    config?: DeleteWorkspaceResponse['config']
    selectedRepoId: string | null
  }>
}): Promise<DeleteWorkspaceResponse> {
  const worktreeDetails = await inspectWorktreeRepo(repo.repoPath)

  if (worktreeDetails === null && !repo.sourceRepoPath && !repo.workspaceBranchName) {
    throw new Error('Delete workspace is only available for Git worktrees.')
  }

  if (worktreeDetails === null && (await pathExists(repo.repoPath))) {
    throw new Error('Delete workspace is only available for Git worktrees.')
  }

  const repoPath = worktreeDetails?.repoPath ?? normalizePath(repo.repoPath)
  const sourceRepoPathCandidate = worktreeDetails?.sourceRepoPath ?? repo.sourceRepoPath ?? null
  const warnings: string[] = []
  let sourceRepoPath: string | null = null

  if (sourceRepoPathCandidate) {
    try {
      sourceRepoPath = await validateSourceRepoPath(sourceRepoPathCandidate)
    } catch {
      warnings.push(
        'Workspace source repository could not be validated, so prune and branch deletion may be skipped.'
      )
    }
  }

  if (sourceRepoPath && normalizePath(repoPath) === sourceRepoPath) {
    throw new Error('Refusing to delete the source repository root.')
  }

  const worktreeEntry =
    sourceRepoPath !== null ? await findWorktreeEntry(sourceRepoPath, repoPath) : null
  const branchNameCandidate =
    worktreeDetails?.branchName ?? worktreeEntry?.branchName ?? repo.workspaceBranchName ?? null
  const branchName =
    sourceRepoPath && branchNameCandidate
      ? await validateBranchName(sourceRepoPath, branchNameCandidate)
      : null
  const killedProcessCount = await terminateTrackedWorkspaceProcesses(
    repoPath,
    repo.workspaceProcesses
  )
  const repoPathExists = await pathExists(repoPath)
  let folderDeleted = !repoPathExists

  if (repoPathExists && sourceRepoPath) {
    try {
      await runGitCommand(sourceRepoPath, ['worktree', 'remove', '--force', repoPath])
      folderDeleted = true
    } catch {
      warnings.push(
        `Git worktree remove failed for ${basename(repoPath)}. If another process is still using this workspace, stop it manually before retrying.`
      )
    }
  }

  if (!folderDeleted) {
    try {
      await rm(repoPath, {
        recursive: true,
        force: true,
        maxRetries: 3
      })

      folderDeleted = !(await pathExists(repoPath))
    } catch {
      throw new Error(
        'Workspace folder could not be removed. Another process may still be using this workspace.'
      )
    }
  }

  if (!folderDeleted) {
    throw new Error(
      'Workspace folder could not be removed. Another process may still be using this workspace.'
    )
  }

  let worktreePruned = false

  if (sourceRepoPath) {
    try {
      await runGitCommand(sourceRepoPath, ['worktree', 'prune'])
      worktreePruned = true
    } catch {
      warnings.push('Git worktree prune failed.')
    }
  } else {
    warnings.push(
      'Workspace source repository could not be determined, so worktree prune was skipped.'
    )
  }

  let branchDeleted = false

  if (sourceRepoPath && branchName) {
    try {
      await runGitCommand(sourceRepoPath, ['branch', '-D', branchName])
      branchDeleted = true
    } catch {
      warnings.push(`Git branch deletion failed for ${branchName}.`)
    }
  } else {
    warnings.push('Workspace branch could not be determined, so branch deletion was skipped.')
  }

  const softDeleteResult = await softDeleteRepo()
  const messageParts = [
    killedProcessCount > 0
      ? `Stopped ${killedProcessCount} related process${killedProcessCount === 1 ? '' : 'es'}`
      : 'No related processes were running',
    folderDeleted ? 'deleted the workspace folder' : 'workspace folder deletion was skipped',
    worktreePruned ? 'pruned the worktree metadata' : 'worktree prune was skipped',
    branchDeleted ? 'deleted the branch' : 'branch deletion was skipped'
  ]

  if (warnings.length > 0) {
    messageParts.push(warnings.join(' '))
  }

  return {
    config: softDeleteResult.config,
    deletedRepoId: repo.id,
    selectedRepoId: softDeleteResult.selectedRepoId,
    summary: {
      branchDeleted,
      folderDeleted,
      killedProcessCount,
      message: `${messageParts.join(', ')}.`,
      worktreePruned
    }
  }
}
