import { spawn, execFile, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, open, realpath, writeFile, type FileHandle } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import type { Readable } from 'node:stream'
import { promisify } from 'node:util'
import type { WebContents } from 'electron'
import type {
  AgentRunEvent,
  AgentRunStatus,
  CancelAgentRunInput,
  CancelAgentRunResponse,
  DeskbinderConfig,
  RepoSettings,
  RunAgentInput,
  RunAgentResponse
} from '@deskbinder/shared/deskbinder'
import { IPC_CHANNELS } from '../../shared/ipcChannels'
import type { LocalConfigStore } from './localConfig'

const execFileAsync = promisify(execFile)
const PROMPT_MAX_CHARACTERS = 100_000
const MAX_STREAM_LOG_BYTES = 10 * 1024 * 1024
const LAST_MESSAGE_MAX_BYTES = 256 * 1024
const AGENT_TIMEOUT_MS = 2 * 60 * 60 * 1000
const PROCESS_SHUTDOWN_WAIT_MS = 1_500
const AGENT_RUN_LOG_DIRECTORY = 'agent-runs'
const STDOUT_LOG_FILENAME = 'codex.stdout.log'
const STDERR_LOG_FILENAME = 'codex.stderr.log'
const LAST_MESSAGE_FILENAME = 'codex-last-message.md'
const RUN_METADATA_FILENAME = 'metadata.json'
const TRUNCATION_MARKER = '\n[deskbinder: output truncated]\n'

type StreamState = {
  bytes: number
  truncated: boolean
  stream: WriteStream
}

type ActiveAgentRun = {
  child: AgentChildProcess
  completed: Promise<void>
  finish: (details: FinishDetails) => void
  lastMessagePath: string
  repoId: string
  runId: string
  stderr: StreamState
  stdout: StreamState
  timeout: NodeJS.Timeout
  webContents: WebContents
  requestedStatus: Exclude<AgentRunStatus, 'running'> | null
  sequence: number
}

type AgentChildProcess = ChildProcessByStdio<null, Readable, Readable>

type FinishDetails = {
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  status?: Exclude<AgentRunStatus, 'running'>
  errorMessage?: string
}

type ValidatedRunInput = {
  branchName: string
  promptText: string
  repo: RepoSettings
  workspacePath: string
}

type AgentRunLogPaths = {
  directoryPath: string
  lastMessagePath: string
  metadataPath: string
  stderrPath: string
  stdoutPath: string
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds)
  })
}

function sendAgentEvent(webContents: WebContents, event: AgentRunEvent): void {
  if (webContents.isDestroyed()) {
    return
  }

  webContents.send(IPC_CHANNELS.agentEvent, event)
}

function writeStreamEnd(stream: WriteStream): Promise<void> {
  return new Promise((resolvePromise) => {
    stream.end(resolvePromise)
  })
}

async function readLastMessage(path: string): Promise<string | undefined> {
  let fileHandle: FileHandle | undefined

  try {
    fileHandle = await open(path, 'r')
    const buffer = Buffer.alloc(LAST_MESSAGE_MAX_BYTES)
    const result = await fileHandle.read(buffer, 0, LAST_MESSAGE_MAX_BYTES, 0)
    const value = buffer.subarray(0, result.bytesRead).toString('utf8').trim()

    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  } finally {
    await fileHandle?.close()
  }
}

function getCompletionStatus(
  details: FinishDetails,
  requestedStatus: Exclude<AgentRunStatus, 'running'> | null
): Exclude<AgentRunStatus, 'running'> {
  if (details.status) {
    return details.status
  }

  if (requestedStatus) {
    return requestedStatus
  }

  return details.exitCode === 0 ? 'succeeded' : 'failed'
}

function terminateProcess(child: AgentChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, signal)
      return
    }

    child.kill(signal)
  } catch {
    // Ignore already-exited processes and permission errors during best-effort termination.
  }
}

async function validateRepoRoot(repoPath: string): Promise<string> {
  const resolvedRepoPath = normalize(await realpath(repoPath))
  const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: resolvedRepoPath,
    encoding: 'utf8',
    maxBuffer: 64 * 1024
  })
  const gitTopLevel = normalize(await realpath(stdout.trim()))

  if (gitTopLevel !== resolvedRepoPath) {
    throw new Error('Selected repo path is not the Git repository root.')
  }

  return resolvedRepoPath
}

async function getCurrentBranchName(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 64 * 1024
    })
    const branchName = sanitizeString(stdout)

    return branchName ?? 'detached-head'
  } catch {
    return 'unknown-branch'
  }
}

function sanitizePathSegment(value: string): string {
  const segment = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)

  return segment || 'unknown'
}

function formatRunTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[:.]/g, '-')
}

function buildAgentRunLogPaths(
  logRootPath: string,
  input: ValidatedRunInput,
  runId: string,
  startedAt: number
): AgentRunLogPaths {
  const repoSegment = sanitizePathSegment(`${input.repo.name}-${input.repo.id}`)
  const branchSegment = sanitizePathSegment(input.branchName)
  const runSegment = sanitizePathSegment(`${formatRunTimestamp(startedAt)}-${runId}`)
  const directoryPath = join(
    logRootPath,
    AGENT_RUN_LOG_DIRECTORY,
    repoSegment,
    branchSegment,
    runSegment
  )

  return {
    directoryPath,
    stdoutPath: join(directoryPath, STDOUT_LOG_FILENAME),
    stderrPath: join(directoryPath, STDERR_LOG_FILENAME),
    lastMessagePath: join(directoryPath, LAST_MESSAGE_FILENAME),
    metadataPath: join(directoryPath, RUN_METADATA_FILENAME)
  }
}

function getRepo(config: DeskbinderConfig, repoId: string): RepoSettings | null {
  return config.repos.find((repo) => repo.id === repoId && !repo.deleted) ?? null
}

export class AgentRunner {
  private activeRun: ActiveAgentRun | null = null

  constructor(
    private readonly localConfigStore: LocalConfigStore,
    private readonly logRootPath: string
  ) {}

  async run(input: unknown, webContents: WebContents): Promise<RunAgentResponse> {
    if (this.activeRun) {
      return {
        ok: false,
        errorMessage: 'A Codex run is already active.'
      }
    }

    let validatedInput: ValidatedRunInput

    try {
      validatedInput = await this.validateRunInput(input)
    } catch (error) {
      return {
        ok: false,
        errorMessage: error instanceof Error ? error.message : 'Unable to start Codex.'
      }
    }

    const runId = randomUUID()
    const startedAt = Date.now()
    const logPaths = buildAgentRunLogPaths(this.logRootPath, validatedInput, runId, startedAt)
    let stdout: StreamState
    let stderr: StreamState
    let child: AgentChildProcess

    try {
      await mkdir(logPaths.directoryPath, { recursive: true })
      await Promise.all([
        writeFile(logPaths.stdoutPath, '', 'utf8'),
        writeFile(logPaths.stderrPath, '', 'utf8'),
        writeFile(logPaths.lastMessagePath, '', 'utf8'),
        writeFile(
          logPaths.metadataPath,
          JSON.stringify(
            {
              runId,
              repoId: validatedInput.repo.id,
              repoName: validatedInput.repo.name,
              repoPath: validatedInput.repo.repoPath,
              sourceRepoId: validatedInput.repo.sourceRepoId,
              sourceRepoPath: validatedInput.repo.sourceRepoPath,
              workspacePath: validatedInput.workspacePath,
              branchName: validatedInput.branchName,
              startedAt
            },
            null,
            2
          ) + '\n',
          'utf8'
        )
      ])
      stdout = {
        bytes: 0,
        truncated: false,
        stream: createWriteStream(logPaths.stdoutPath, { flags: 'a', encoding: 'utf8' })
      }
      stderr = {
        bytes: 0,
        truncated: false,
        stream: createWriteStream(logPaths.stderrPath, { flags: 'a', encoding: 'utf8' })
      }
      stdout.stream.on('error', () => {})
      stderr.stream.on('error', () => {})
      child = spawn(
        validatedInput.repo.agentExecutable ?? 'codex',
        ['exec', validatedInput.promptText, '-o', logPaths.lastMessagePath],
        {
          cwd: validatedInput.workspacePath,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32'
        }
      )
    } catch {
      return {
        ok: false,
        errorMessage: 'Codex run output files could not be prepared.'
      }
    }
    let resolveCompleted: () => void = () => {}
    const completed = new Promise<void>((resolvePromise) => {
      resolveCompleted = resolvePromise
    })
    const timeout = setTimeout(() => {
      const run = this.activeRun

      if (run?.runId !== runId) {
        return
      }

      run.requestedStatus = 'timed_out'
      terminateProcess(child, 'SIGTERM')
      void sleep(PROCESS_SHUTDOWN_WAIT_MS).then(() => {
        if (this.activeRun?.runId !== runId) {
          return
        }

        terminateProcess(child, 'SIGKILL')
      })
    }, AGENT_TIMEOUT_MS)
    let settled = false

    const activeRun: ActiveAgentRun = {
      child,
      completed,
      finish: (details) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)

        void this.finishRun(activeRun, details).finally(() => {
          resolveCompleted()
        })
      },
      lastMessagePath: logPaths.lastMessagePath,
      repoId: validatedInput.repo.id,
      runId,
      stderr,
      stdout,
      timeout,
      webContents,
      requestedStatus: null,
      sequence: 0
    }

    this.activeRun = activeRun

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.handleOutput(activeRun, 'stdout', chunk)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.handleOutput(activeRun, 'stderr', chunk)
    })

    child.on('error', () => {
      activeRun.finish({
        status: 'failed',
        errorMessage: 'Codex could not be started.'
      })
    })

    child.on('close', (exitCode, signal) => {
      activeRun.finish({
        exitCode,
        signal
      })
    })

    sendAgentEvent(webContents, {
      type: 'started',
      runId,
      repoId: validatedInput.repo.id,
      startedAt
    })

    return {
      ok: true,
      runId,
      repoId: validatedInput.repo.id,
      status: 'running'
    }
  }

  cancel(input: unknown): CancelAgentRunResponse {
    const runId = this.getRunIdInput(input)
    const activeRun = this.activeRun

    if (!runId) {
      return {
        ok: false,
        runId: '',
        status: 'failed',
        errorMessage: 'Invalid Codex run selection.'
      }
    }

    if (!activeRun || activeRun.runId !== runId) {
      return {
        ok: false,
        runId,
        status: 'failed',
        errorMessage: 'No active Codex run matches that selection.'
      }
    }

    activeRun.requestedStatus = 'cancelled'
    terminateProcess(activeRun.child, 'SIGTERM')
    void sleep(PROCESS_SHUTDOWN_WAIT_MS).then(() => {
      if (this.activeRun?.runId !== runId) {
        return
      }

      terminateProcess(activeRun.child, 'SIGKILL')
    })

    return {
      ok: true,
      runId,
      status: 'cancelled'
    }
  }

  async cancelActiveRun(): Promise<void> {
    const activeRun = this.activeRun

    if (!activeRun) {
      return
    }

    activeRun.requestedStatus = 'cancelled'
    terminateProcess(activeRun.child, 'SIGTERM')
    await sleep(PROCESS_SHUTDOWN_WAIT_MS)

    if (this.activeRun?.runId === activeRun.runId) {
      terminateProcess(activeRun.child, 'SIGKILL')
    }

    await activeRun.completed
  }

  private async validateRunInput(input: unknown): Promise<ValidatedRunInput> {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid Codex run input.')
    }

    const record = input as Partial<RunAgentInput>
    const repoId = sanitizeString(record.repoId)
    const promptText = sanitizeString(record.promptText)

    if (!repoId) {
      throw new Error('Repo selection is required.')
    }

    if (!promptText) {
      throw new Error('Prompt text is required.')
    }

    if (promptText.length > PROMPT_MAX_CHARACTERS) {
      throw new Error('Prompt text is too long.')
    }

    const config = await this.localConfigStore.read()
    const repo = getRepo(config, repoId)

    if (!repo) {
      throw new Error('Selected repo is no longer configured.')
    }

    if (repo.agentExecutable !== 'codex') {
      throw new Error('Only the Codex agent is supported for this runner.')
    }

    const workspacePath = await validateRepoRoot(repo.repoPath)

    return {
      branchName: repo.workspaceBranchName ?? (await getCurrentBranchName(workspacePath)),
      promptText,
      repo,
      workspacePath
    }
  }

  private getRunIdInput(input: unknown): string | null {
    if (!input || typeof input !== 'object') {
      return null
    }

    return sanitizeString((input as Partial<CancelAgentRunInput>).runId)
  }

  private handleOutput(
    activeRun: ActiveAgentRun,
    streamName: 'stdout' | 'stderr',
    chunk: string
  ): void {
    const streamState = activeRun[streamName]

    if (streamState.truncated) {
      return
    }

    const chunkBytes = Buffer.byteLength(chunk)

    if (streamState.bytes + chunkBytes > MAX_STREAM_LOG_BYTES) {
      streamState.truncated = true
      streamState.stream.write(TRUNCATION_MARKER)
      return
    }

    streamState.bytes += chunkBytes
    streamState.stream.write(chunk)
    activeRun.sequence += 1
    sendAgentEvent(activeRun.webContents, {
      type: streamName,
      runId: activeRun.runId,
      chunk,
      sequence: activeRun.sequence
    })
  }

  private async finishRun(activeRun: ActiveAgentRun, details: FinishDetails): Promise<void> {
    await Promise.all([
      writeStreamEnd(activeRun.stdout.stream),
      writeStreamEnd(activeRun.stderr.stream)
    ])

    const status = getCompletionStatus(details, activeRun.requestedStatus)
    const lastMessage = await readLastMessage(activeRun.lastMessagePath)
    const errorMessage =
      details.errorMessage ??
      (status === 'failed' ? `Codex exited with code ${details.exitCode ?? 'unknown'}.` : undefined)

    sendAgentEvent(activeRun.webContents, {
      type: 'completed',
      runId: activeRun.runId,
      repoId: activeRun.repoId,
      status,
      exitCode: details.exitCode ?? undefined,
      signal: details.signal ?? undefined,
      errorMessage,
      lastMessage,
      completedAt: Date.now(),
      stdoutTruncated: activeRun.stdout.truncated,
      stderrTruncated: activeRun.stderr.truncated
    })

    if (this.activeRun?.runId === activeRun.runId) {
      this.activeRun = null
    }
  }
}
