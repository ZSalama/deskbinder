import { readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, normalize, relative, resolve } from 'node:path'
import type { TrackedWorkspaceProcess } from '@deskbinder/shared/deskbinder'

const PROCESS_SHUTDOWN_WAIT_MS = 1_500

type ProcessInfo = {
  cwdPath: string | null
  pid: number
  ppid: number
  startTimeTicks: number
}

function normalizePath(path: string): string {
  return normalize(isAbsolute(path) ? path : resolve(path))
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const pathRelative = relative(rootPath, targetPath)
  return pathRelative === '' || (!pathRelative.startsWith('..') && !isAbsolute(pathRelative))
}

async function readProcessInfo(pid: number): Promise<ProcessInfo | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const closingParenIndex = stat.lastIndexOf(')')

    if (closingParenIndex === -1) {
      return null
    }

    const remaining = stat
      .slice(closingParenIndex + 2)
      .trim()
      .split(/\s+/)
    const ppid = Number(remaining[1])
    const startTimeTicks = Number(remaining[19])

    if (!Number.isInteger(ppid) || !Number.isFinite(startTimeTicks) || startTimeTicks <= 0) {
      return null
    }

    let cwdPath: string | null = null

    try {
      cwdPath = normalize(await realpath(`/proc/${pid}/cwd`))
    } catch {
      cwdPath = null
    }

    return {
      pid,
      ppid,
      cwdPath,
      startTimeTicks
    }
  } catch {
    return null
  }
}

async function getProcessSnapshot(): Promise<Map<number, ProcessInfo>> {
  let directoryEntries

  try {
    directoryEntries = await readdir('/proc', { withFileTypes: true })
  } catch {
    return new Map<number, ProcessInfo>()
  }

  const pids = directoryEntries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((pid) => Number.isInteger(pid) && pid > 1)

  const processes = await Promise.all(pids.map((pid) => readProcessInfo(pid)))
  const snapshot = new Map<number, ProcessInfo>()

  for (const processInfo of processes) {
    if (!processInfo) {
      continue
    }

    snapshot.set(processInfo.pid, processInfo)
  }

  return snapshot
}

function collectDescendantPids(
  rootPids: Iterable<number>,
  snapshot: Map<number, ProcessInfo>
): Set<number> {
  const collected = new Set<number>()
  const queue = [...rootPids].filter((pid) => Number.isInteger(pid) && pid > 1)

  while (queue.length > 0) {
    const pid = queue.shift()

    if (!pid || collected.has(pid)) {
      continue
    }

    collected.add(pid)

    for (const processInfo of snapshot.values()) {
      if (processInfo.ppid === pid && !collected.has(processInfo.pid)) {
        queue.push(processInfo.pid)
      }
    }
  }

  return collected
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds)
  })
}

function matchesTrackedProcess(
  processInfo: ProcessInfo,
  trackedProcess: TrackedWorkspaceProcess,
  repoPath: string
): boolean {
  if (
    processInfo.pid === process.pid ||
    processInfo.startTimeTicks !== trackedProcess.startTimeTicks
  ) {
    return false
  }

  if (processInfo.cwdPath && !isPathWithin(repoPath, processInfo.cwdPath)) {
    return false
  }

  return true
}

export async function collectTrackedWorkspaceProcesses(
  repoPath: string,
  candidatePids: number[]
): Promise<TrackedWorkspaceProcess[]> {
  const normalizedRepoPath = normalizePath(repoPath)
  const uniquePids = [...new Set(candidatePids)].filter(
    (pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid
  )
  const processes = await Promise.all(uniquePids.map((pid) => readProcessInfo(pid)))

  return processes
    .filter((processInfo): processInfo is ProcessInfo => processInfo !== null)
    .filter(
      (processInfo) => !processInfo.cwdPath || isPathWithin(normalizedRepoPath, processInfo.cwdPath)
    )
    .map((processInfo) => ({
      pid: processInfo.pid,
      startTimeTicks: processInfo.startTimeTicks,
      cwdPath: processInfo.cwdPath ?? undefined
    }))
}

export async function isTrackedWorkspaceProcessLive(
  repoPath: string,
  trackedProcess: TrackedWorkspaceProcess
): Promise<boolean> {
  const normalizedRepoPath = normalizePath(repoPath)
  const processInfo = await readProcessInfo(trackedProcess.pid)

  return processInfo ? matchesTrackedProcess(processInfo, trackedProcess, normalizedRepoPath) : false
}

export async function terminateTrackedWorkspaceProcesses(
  repoPath: string,
  trackedProcesses: TrackedWorkspaceProcess[] | undefined
): Promise<number> {
  const normalizedRepoPath = normalizePath(repoPath)
  const expectedProcesses = trackedProcesses ?? []

  if (expectedProcesses.length === 0) {
    return 0
  }

  const snapshot = await getProcessSnapshot()
  const rootPids = new Set<number>()

  for (const trackedProcess of expectedProcesses) {
    const liveProcess = snapshot.get(trackedProcess.pid)

    if (!liveProcess || !matchesTrackedProcess(liveProcess, trackedProcess, normalizedRepoPath)) {
      continue
    }

    rootPids.add(liveProcess.pid)
  }

  const descendantPids = collectDescendantPids(rootPids, snapshot)
  const orderedPids = [...descendantPids].sort((left, right) => right - left)

  for (const pid of orderedPids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Ignore exited processes and permission errors for best-effort cleanup.
    }
  }

  if (orderedPids.length > 0) {
    await sleep(PROCESS_SHUTDOWN_WAIT_MS)
  }

  for (const pid of orderedPids) {
    if (!isProcessAlive(pid)) {
      continue
    }

    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Ignore exited processes and permission errors for best-effort cleanup.
    }
  }

  return orderedPids.length
}
