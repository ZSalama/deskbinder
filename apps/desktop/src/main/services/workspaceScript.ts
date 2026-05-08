import { spawn } from 'node:child_process'
import { access, constants, realpath } from 'node:fs/promises'
import { isAbsolute, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import type { RepoSettings, WorkspaceScriptResult } from '@deskbinder/shared/deskbinder'

const execFileAsync = promisify(execFile)
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000
const MAX_OUTPUT_BYTES = 256 * 1024
const DEFAULT_WORKSPACE_SCRIPT_PATH = 'new_workspace'

type WorkspaceScriptRunOptions = {
  branchName: string
  repo: RepoSettings
  scriptArgs?: string
}

function sanitizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function sanitizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const entries = Object.entries(value).filter(([, entryValue]) => typeof entryValue === 'string')

  if (!entries.length) {
    return undefined
  }

  return Object.fromEntries(entries) as Record<string, string>
}

function sanitizeNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const entries = Object.entries(value).filter(([, entryValue]) => typeof entryValue === 'number')

  if (!entries.length) {
    return undefined
  }

  return Object.fromEntries(entries) as Record<string, number>
}

function parseArgString(input: string | undefined, label = 'Script args'): string[] {
  if (!input?.trim()) {
    return []
  }

  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const character of input) {
    if (escaping) {
      current += character
      escaping = false
      continue
    }

    if (character === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        current += character
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += character
  }

  if (escaping || quote) {
    throw new Error(`${label} contain unmatched quotes or escapes.`)
  }

  if (current.length > 0) {
    args.push(current)
  }

  return args
}

function extractJsonObject(stdout: string): unknown {
  const trimmedOutput = stdout.trim()

  if (!trimmedOutput) {
    throw new Error('Workspace script did not print a JSON result.')
  }

  try {
    return JSON.parse(trimmedOutput)
  } catch {
    for (
      let index = trimmedOutput.lastIndexOf('{');
      index >= 0;
      index = trimmedOutput.lastIndexOf('{', index - 1)
    ) {
      try {
        return JSON.parse(trimmedOutput.slice(index))
      } catch {
        continue
      }
    }
  }

  throw new Error('Workspace script output did not end with valid JSON.')
}

function normalizeWorkspaceScriptResult(
  value: unknown,
  branchName: string,
  repoPath: string
): WorkspaceScriptResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Workspace script returned an invalid JSON payload.')
  }

  const record = value as Record<string, unknown>
  const logs = sanitizeStringRecord(record.logs)
  const processes = sanitizeNumberRecord(record.processes)

  return {
    ok: record.ok === true,
    agentRunnable: record.agentRunnable === true,
    repoPath: sanitizeString(record.repoPath) ?? repoPath,
    workspacePath: sanitizeString(record.workspacePath),
    workspaceName: sanitizeString(record.workspaceName),
    branchName: sanitizeString(record.branchName) ?? branchName,
    baseBranch: sanitizeString(record.baseBranch),
    port: sanitizeNumber(record.port),
    url: sanitizeString(record.url),
    logs:
      logs && (logs.workspace || logs.dev || logs.convex)
        ? {
            workspace: logs.workspace,
            dev: logs.dev,
            convex: logs.convex
          }
        : undefined,
    processes:
      processes && (processes.dev !== undefined || processes.convex !== undefined)
        ? {
            dev: processes.dev,
            convex: processes.convex
          }
        : undefined,
    failureStep: sanitizeString(record.failureStep),
    errorMessage: sanitizeString(record.errorMessage)
  }
}

function buildFailureResult(
  branchName: string,
  errorMessage: string,
  failureStep: string,
  repoPath?: string
): WorkspaceScriptResult {
  return {
    ok: false,
    agentRunnable: false,
    branchName,
    repoPath,
    failureStep,
    errorMessage
  }
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`)
}

function trimOutput(value: string): string {
  const trimmed = value.trim()

  if (trimmed.length <= 2000) {
    return trimmed
  }

  return `${trimmed.slice(0, 2000)}...`
}

async function validateBranchName(repoPath: string, branchName: string): Promise<void> {
  try {
    await execFileAsync('git', ['check-ref-format', '--branch', branchName], {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 64 * 1024
    })
  } catch {
    throw new Error('Branch name is invalid.')
  }
}

async function validateScriptPath(
  repoPath: string,
  workspaceScriptPath: string | undefined
): Promise<string> {
  const configuredPath = sanitizeString(workspaceScriptPath) ?? DEFAULT_WORKSPACE_SCRIPT_PATH

  if (isAbsolute(configuredPath)) {
    throw new Error('Workspace script path must be repo-relative.')
  }

  const resolvedRepoPath = normalize(await realpath(repoPath))
  const candidatePath = normalize(resolve(resolvedRepoPath, configuredPath))
  let resolvedScriptPath: string

  try {
    resolvedScriptPath = normalize(await realpath(candidatePath))
  } catch {
    throw new Error('Workspace script path does not exist.')
  }

  if (!isPathWithin(resolvedRepoPath, resolvedScriptPath)) {
    throw new Error('Workspace script path must stay within the repo root.')
  }

  try {
    await access(resolvedScriptPath, constants.X_OK)
  } catch {
    throw new Error('Workspace script path must point to an executable file.')
  }

  return resolvedScriptPath
}

export async function runWorkspaceScript({
  branchName,
  repo,
  scriptArgs
}: WorkspaceScriptRunOptions): Promise<WorkspaceScriptResult> {
  const normalizedBranchName = sanitizeString(branchName)

  if (!normalizedBranchName) {
    return buildFailureResult(
      branchName,
      'Branch name is required.',
      'input_validation',
      repo.repoPath
    )
  }

  try {
    await validateBranchName(repo.repoPath, normalizedBranchName)
    const executablePath = await validateScriptPath(repo.repoPath, repo.workspaceScriptPath)
    const rawScriptArgs = scriptArgs === undefined ? repo.defaultScriptArgs : scriptArgs
    const scriptArgLabel = scriptArgs === undefined ? 'Default script args' : 'Script args'
    const resolvedScriptArgs = [
      normalizedBranchName,
      ...parseArgString(rawScriptArgs, scriptArgLabel)
    ]

    return await new Promise<WorkspaceScriptResult>((resolveResult) => {
      const child = spawn(executablePath, resolvedScriptArgs, {
        cwd: repo.repoPath,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      let stdoutBytes = 0
      let stderrBytes = 0
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
      }, SCRIPT_TIMEOUT_MS)

      const finish = (result: WorkspaceScriptResult): void => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        resolveResult(result)
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBytes += Buffer.byteLength(chunk)

        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          child.kill('SIGTERM')
          finish(
            buildFailureResult(
              normalizedBranchName,
              'Workspace script stdout exceeded the maximum supported size.',
              'output_limit',
              repo.repoPath
            )
          )
          return
        }

        stdout += chunk
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderrBytes += Buffer.byteLength(chunk)

        if (stderrBytes > MAX_OUTPUT_BYTES) {
          child.kill('SIGTERM')
          finish(
            buildFailureResult(
              normalizedBranchName,
              'Workspace script stderr exceeded the maximum supported size.',
              'output_limit',
              repo.repoPath
            )
          )
          return
        }

        stderr += chunk
      })

      child.on('error', () => {
        finish(
          buildFailureResult(
            normalizedBranchName,
            'Workspace script could not be started.',
            'script_launch',
            repo.repoPath
          )
        )
      })

      child.on('close', (code, signal) => {
        if (settled) {
          return
        }

        clearTimeout(timeout)

        if (signal) {
          const failureStep = signal === 'SIGTERM' ? 'timeout' : 'script_signal'
          const errorMessage =
            signal === 'SIGTERM'
              ? 'Workspace script timed out before finishing.'
              : `Workspace script exited after signal ${signal}.`

          finish(buildFailureResult(normalizedBranchName, errorMessage, failureStep, repo.repoPath))
          return
        }

        if (code !== 0) {
          finish(
            buildFailureResult(
              normalizedBranchName,
              trimOutput(stderr) || `Workspace script exited with code ${code}.`,
              'script_execution',
              repo.repoPath
            )
          )
          return
        }

        try {
          const parsedResult = extractJsonObject(stdout)
          const normalizedResult = normalizeWorkspaceScriptResult(
            parsedResult,
            normalizedBranchName,
            repo.repoPath
          )

          finish(normalizedResult)
        } catch (error) {
          finish(
            buildFailureResult(
              normalizedBranchName,
              error instanceof Error ? error.message : 'Workspace script returned invalid JSON.',
              'result_parse',
              repo.repoPath
            )
          )
        }
      })
    })
  } catch (error) {
    return buildFailureResult(
      normalizedBranchName,
      error instanceof Error ? error.message : 'Workspace script validation failed.',
      'input_validation',
      repo.repoPath
    )
  }
}
