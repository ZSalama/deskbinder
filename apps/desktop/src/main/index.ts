import { app, shell, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { AppVersions, FolderPickResult } from '@deskbinder/shared/ipc'
import {
  MAX_WORKSPACE_BATCH_COUNT,
  type RepoSettings,
  type RunWorkspaceScriptResponse,
  type RunWorkspaceScriptsResponse,
  type WorkspaceScriptRunResponse,
  type WorkspaceScriptResult
} from '@deskbinder/shared/deskbinder'
import { LocalConfigStore } from './services/localConfig'
import { createRendererServer, type RendererServer } from './services/rendererServer'
import { deleteWorkspaceForRepo } from './services/deleteWorkspace'
import {
  collectTrackedWorkspaceProcesses,
  terminateTrackedWorkspaceProcesses
} from './services/processTracking'
import { AgentRunner } from './services/agentRunner'
import { runWorkspaceScript } from './services/workspaceScript'
import { ConvexSession } from './services/convexSession'
import { ConvexRepoStore, desktopRepoToRepoSettings } from './services/convexRepoStore'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import icon from '../../resources/icon.png?asset'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])
const WORKSPACE_SCRIPT_CONCURRENCY_FAILURE_STEP = 'concurrency_guard'
const USE_BUILT_RENDERER = process.env['DESKBINDER_USE_BUILT_RENDERER'] === '1'

function getRendererUrl(): URL | null {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']

  if (!rendererUrl) {
    return null
  }

  const parsedUrl = new URL(rendererUrl)
  const isAllowedHost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1'

  if (parsedUrl.protocol !== 'http:' || !isAllowedHost) {
    throw new Error(`Unexpected renderer origin: ${parsedUrl.origin}`)
  }

  return parsedUrl
}

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol)
  } catch {
    return false
  }
}

function getAppVersions(): AppVersions {
  return {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node
  }
}

async function pickFolder(window: BrowserWindow | null): Promise<FolderPickResult> {
  const options: OpenDialogOptions = {
    title: 'Select a folder',
    buttonLabel: 'Select folder',
    properties: ['openDirectory', 'createDirectory']
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  return {
    canceled: result.canceled,
    path: result.canceled ? null : (result.filePaths[0] ?? null)
  }
}

let rendererServer: RendererServer | null = null
let localConfigStore: LocalConfigStore | null = null
let convexSession: ConvexSession | null = null
let convexRepoStore: ConvexRepoStore | null = null
let agentRunner: AgentRunner | null = null
let activeWorkspaceScriptRun: Promise<
  RunWorkspaceScriptResponse | RunWorkspaceScriptsResponse
> | null = null
let hasCompletedQuitCleanup = false
let quitCleanupPromise: Promise<void> | null = null

function getStringInput(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') {
    return ''
  }

  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

function getOptionalStringInput(
  input: unknown,
  key: string
):
  | { provided: false }
  | { provided: true; value: string | undefined }
  | { provided: true; errorMessage: string } {
  if (!input || typeof input !== 'object' || !(key in input)) {
    return { provided: false }
  }

  const value = (input as Record<string, unknown>)[key]

  if (value === undefined || value === null) {
    return { provided: true, value: undefined }
  }

  if (typeof value !== 'string') {
    return { provided: true, errorMessage: 'Default script args must be text.' }
  }

  const trimmedValue = value.trim()

  return { provided: true, value: trimmedValue || undefined }
}

async function getProductionRendererUrl(): Promise<URL> {
  if (!rendererServer) {
    rendererServer = await createRendererServer()
  }

  return new URL(rendererServer.origin)
}

async function cleanupBeforeQuit(): Promise<void> {
  if (agentRunner) {
    await agentRunner.cancelActiveRun()
  }

  if (localConfigStore) {
    const trackedWorkspaces = (await localConfigStore.read()).trackedWorkspaces
    const repoIdsToClear = trackedWorkspaces
      .filter((repo) => (repo.workspaceProcesses?.length ?? 0) > 0)
      .map((repo) => repo.repoId)

    await Promise.all(
      trackedWorkspaces.map(async (repo) => {
        await terminateTrackedWorkspaceProcesses(repo.repoPath, repo.workspaceProcesses)
      })
    )

    if (repoIdsToClear.length > 0) {
      await localConfigStore.clearWorkspaceProcesses(repoIdsToClear)
    }
  }

  if (rendererServer) {
    await rendererServer.close()
    rendererServer = null
  }
}

function buildWorkspaceScriptResultFailure(
  branchName: string,
  failureStep: string,
  errorMessage: string
): WorkspaceScriptResult {
  return {
    ok: false,
    agentRunnable: false,
    branchName,
    failureStep,
    errorMessage
  }
}

function buildWorkspaceScriptRunFailure({
  branchName,
  errorMessage,
  failureStep,
  index
}: {
  branchName: string
  errorMessage: string
  failureStep: string
  index: number
}): WorkspaceScriptRunResponse {
  return {
    index,
    branchName,
    selectedRepoId: null,
    result: buildWorkspaceScriptResultFailure(branchName, failureStep, errorMessage)
  }
}

function getWorkspaceBatchRunsInput(input: unknown):
  | {
      ok: true
      repoId: string
      workspaces: Array<{ branchName: string; scriptArgs?: string }>
    }
  | {
      ok: false
      branchName: string
      errorMessage: string
    } {
  const repoId = getStringInput(input, 'repoId')
  const branchName = getStringInput(input, 'branchName')

  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      branchName,
      errorMessage: 'Invalid workspace batch input.'
    }
  }

  const workspaces = (input as Record<string, unknown>)['workspaces']

  if (!Array.isArray(workspaces)) {
    return {
      ok: false,
      branchName,
      errorMessage: 'Workspace batch is required.'
    }
  }

  if (workspaces.length < 1 || workspaces.length > MAX_WORKSPACE_BATCH_COUNT) {
    return {
      ok: false,
      branchName,
      errorMessage: 'Create between 1 and 5 workspaces at a time.'
    }
  }

  const normalizedWorkspaces = workspaces.map((workspace) => {
    if (!workspace || typeof workspace !== 'object') {
      return null
    }

    const record = workspace as Record<string, unknown>
    const workspaceBranchName =
      typeof record.branchName === 'string' ? record.branchName.trim() : ''
    const workspaceScriptArgs =
      typeof record.scriptArgs === 'string' ? record.scriptArgs : undefined

    return {
      branchName: workspaceBranchName,
      scriptArgs: workspaceScriptArgs
    }
  })

  if (normalizedWorkspaces.some((workspace) => !workspace || !workspace.branchName)) {
    return {
      ok: false,
      branchName,
      errorMessage: 'Every workspace needs a branch name.'
    }
  }

  const branchNames = new Set<string>()

  for (const workspace of normalizedWorkspaces) {
    if (!workspace) {
      continue
    }

    if (branchNames.has(workspace.branchName)) {
      return {
        ok: false,
        branchName: workspace.branchName,
        errorMessage: 'Branch names must be unique.'
      }
    }

    branchNames.add(workspace.branchName)
  }

  return {
    ok: true,
    repoId,
    workspaces: normalizedWorkspaces as Array<{ branchName: string; scriptArgs?: string }>
  }
}

async function runAndRegisterWorkspace({
  branchName,
  index,
  scriptArgs,
  sourceRepo
}: {
  branchName: string
  index: number
  scriptArgs?: string
  sourceRepo: RepoSettings
}): Promise<WorkspaceScriptRunResponse> {
  const result = await runWorkspaceScript({
    branchName,
    repo: sourceRepo,
    scriptArgs
  })

  if (result.ok && result.agentRunnable && result.workspacePath) {
    try {
      const registration = await convexRepoStore!.registerWorkspaceRepo({
        sourceRepo,
        workspacePath: result.workspacePath,
        workspaceName: result.workspaceName,
        branchName: result.branchName
      })
      const workspaceProcesses = await collectTrackedWorkspaceProcesses(
        result.workspacePath,
        [result.processes?.dev, result.processes?.convex].filter(
          (pid): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 1
        )
      )

      await localConfigStore?.trackWorkspace({
        repoId: registration.localRepoId,
        repoPath: registration.repoPath,
        sourceRepoPath: sourceRepo.repoPath,
        workspaceBranchName: registration.workspaceBranchName,
        workspaceProcesses
      })

      return {
        index,
        branchName: result.branchName,
        selectedRepoId: registration.localRepoId,
        result
      }
    } catch (error) {
      return {
        index,
        branchName: result.branchName,
        selectedRepoId: sourceRepo.id,
        result: {
          ...result,
          ok: false,
          agentRunnable: false,
          failureStep: 'workspace_validation',
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Returned workspace path could not be validated.'
        }
      }
    }
  }

  return {
    index,
    branchName: result.branchName,
    selectedRepoId: sourceRepo.id,
    result
  }
}

async function handleRunWorkspaceScript(input: unknown): Promise<RunWorkspaceScriptResponse> {
  if (!convexRepoStore) {
    throw new Error('Convex repo store is unavailable.')
  }

  const repoId = getStringInput(input, 'repoId')
  const branchName = getStringInput(input, 'branchName')
  const defaultScriptArgsInput = getOptionalStringInput(input, 'defaultScriptArgs')
  let sourceRepo: RepoSettings

  if ('errorMessage' in defaultScriptArgsInput) {
    return {
      selectedRepoId: null,
      result: buildWorkspaceScriptResultFailure(
        branchName,
        'input_validation',
        defaultScriptArgsInput.errorMessage
      )
    }
  }

  try {
    sourceRepo = await convexRepoStore.getRepoForExecution(repoId)
  } catch {
    return {
      selectedRepoId: null,
      result: buildWorkspaceScriptResultFailure(
        branchName,
        'repo_lookup',
        'Selected repo is no longer configured.'
      )
    }
  }

  if (defaultScriptArgsInput.provided) {
    try {
      sourceRepo = desktopRepoToRepoSettings(
        await convexRepoStore.updateRepoSettings({
          id: sourceRepo.id,
          name: sourceRepo.name,
          workspaceScriptPath: sourceRepo.workspaceScriptPath,
          defaultScriptArgs: defaultScriptArgsInput.value,
          agentExecutable: sourceRepo.agentExecutable
        })
      )
    } catch (error) {
      return {
        selectedRepoId: sourceRepo.id,
        result: buildWorkspaceScriptResultFailure(
          branchName,
          'repo_update',
          error instanceof Error ? error.message : 'Default script args could not be saved.'
        )
      }
    }
  }

  const response = await runAndRegisterWorkspace({
    branchName,
    index: 0,
    sourceRepo
  })

  return {
    selectedRepoId: response.selectedRepoId,
    result: response.result
  }
}

async function handleRunWorkspaceScripts(input: unknown): Promise<RunWorkspaceScriptsResponse> {
  if (!convexRepoStore) {
    throw new Error('Convex repo store is unavailable.')
  }

  const inputResult = getWorkspaceBatchRunsInput(input)

  if (!inputResult.ok) {
    return {
      selectedRepoId: null,
      results: [
        buildWorkspaceScriptRunFailure({
          index: 0,
          branchName: inputResult.branchName,
          failureStep: 'input_validation',
          errorMessage: inputResult.errorMessage
        })
      ]
    }
  }

  let sourceRepo: RepoSettings

  try {
    sourceRepo = await convexRepoStore.getRepoForExecution(inputResult.repoId)
  } catch {
    return {
      selectedRepoId: null,
      results: inputResult.workspaces.map((workspace, index) =>
        buildWorkspaceScriptRunFailure({
          index,
          branchName: workspace.branchName,
          failureStep: 'repo_lookup',
          errorMessage: 'Selected repo is no longer configured.'
        })
      )
    }
  }

  const results: WorkspaceScriptRunResponse[] = []

  for (const [index, workspace] of inputResult.workspaces.entries()) {
    results.push(
      await runAndRegisterWorkspace({
        index,
        branchName: workspace.branchName,
        scriptArgs: workspace.scriptArgs,
        sourceRepo
      })
    )
  }

  return {
    selectedRepoId:
      results.find((response) => response.result.ok && response.selectedRepoId)?.selectedRepoId ??
      sourceRepo.id,
    results
  }
}

async function createWindow(): Promise<void> {
  const rendererUrl =
    is.dev && !USE_BUILT_RENDERER
      ? (() => {
          const url = getRendererUrl()

          if (!url) {
            throw new Error('Renderer URL is required in development')
          }

          return url
        })()
      : await getProductionRendererUrl()
  const allowedOrigin = rendererUrl.origin
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.webContents.session.setPermissionRequestHandler((_, __, callback) => {
    callback(false)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const nextUrl = new URL(navigationUrl)

      if (nextUrl.origin === allowedOrigin) {
        return
      }
    } catch {
      // Ignore invalid URLs and block the navigation below.
    }

    event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }

    return { action: 'deny' }
  })

  void mainWindow.loadURL(rendererUrl.toString())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  localConfigStore = new LocalConfigStore(app)
  convexSession = new ConvexSession()
  convexRepoStore = new ConvexRepoStore(convexSession, async () => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    return (await localConfigStore.readDeviceConfig()).workerId
  })
  agentRunner = new AgentRunner(async (repoId) => {
    if (!convexRepoStore) {
      throw new Error('Convex repo store is unavailable.')
    }

    return convexRepoStore.getRepoForExecution(repoId)
  }, app.getPath('userData'))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(IPC_CHANNELS.ping, () => 'pong')
  ipcMain.handle(IPC_CHANNELS.getVersions, () => getAppVersions())
  ipcMain.handle(IPC_CHANNELS.pickFolder, (event) => {
    return pickFolder(BrowserWindow.fromWebContents(event.sender))
  })
  ipcMain.handle(IPC_CHANNELS.setConvexSession, async (_, input) => {
    if (!convexSession || !convexRepoStore || !localConfigStore) {
      throw new Error('Convex session store is unavailable.')
    }

    convexSession.set(input)
    await convexRepoStore.registerWorker()
    await convexRepoStore.syncRepoStates()
  })
  ipcMain.handle(IPC_CHANNELS.clearConvexSession, async () => {
    convexSession?.clear()
  })
  ipcMain.handle(IPC_CHANNELS.getDeviceConfig, async () => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    return localConfigStore.readDeviceConfig()
  })
  ipcMain.handle(IPC_CHANNELS.createRemoteRepo, async (_, input) => {
    if (!convexRepoStore) {
      throw new Error('Convex repo store is unavailable.')
    }

    return convexRepoStore.createRepoFromFolder(input)
  })
  ipcMain.handle(IPC_CHANNELS.updateRemoteRepoSettings, async (_, input) => {
    if (!convexRepoStore) {
      throw new Error('Convex repo store is unavailable.')
    }

    return convexRepoStore.updateRepoSettings(input)
  })
  ipcMain.handle(IPC_CHANNELS.syncRepoStates, async () => {
    if (!convexRepoStore) {
      throw new Error('Convex repo store is unavailable.')
    }

    return convexRepoStore.syncRepoStates()
  })
  ipcMain.handle(IPC_CHANNELS.runWorkspaceScript, async (_, input) => {
    if (activeWorkspaceScriptRun) {
      const branchName = getStringInput(input, 'branchName')

      return {
        selectedRepoId: null,
        result: {
          ok: false,
          agentRunnable: false,
          branchName,
          failureStep: WORKSPACE_SCRIPT_CONCURRENCY_FAILURE_STEP,
          errorMessage: 'A workspace script is already running.'
        }
      }
    }

    const workspaceScriptRun = handleRunWorkspaceScript(input)
    activeWorkspaceScriptRun = workspaceScriptRun

    try {
      return await workspaceScriptRun
    } finally {
      if (activeWorkspaceScriptRun === workspaceScriptRun) {
        activeWorkspaceScriptRun = null
      }
    }
  })
  ipcMain.handle(IPC_CHANNELS.runWorkspaceScripts, async (_, input) => {
    if (activeWorkspaceScriptRun) {
      const inputResult = getWorkspaceBatchRunsInput(input)
      let branchName: string

      if (inputResult.ok) {
        branchName = inputResult.workspaces[0]?.branchName ?? ''
      } else {
        branchName = inputResult.branchName
      }

      return {
        selectedRepoId: null,
        results: [
          buildWorkspaceScriptRunFailure({
            index: 0,
            branchName,
            failureStep: WORKSPACE_SCRIPT_CONCURRENCY_FAILURE_STEP,
            errorMessage: 'A workspace script is already running.'
          })
        ]
      }
    }

    const workspaceScriptRun = handleRunWorkspaceScripts(input)
    activeWorkspaceScriptRun = workspaceScriptRun

    try {
      return await workspaceScriptRun
    } finally {
      if (activeWorkspaceScriptRun === workspaceScriptRun) {
        activeWorkspaceScriptRun = null
      }
    }
  })
  ipcMain.handle(IPC_CHANNELS.deleteWorkspace, async (_, input) => {
    if (!convexRepoStore) {
      throw new Error('Convex repo store is unavailable.')
    }

    const repoId = typeof input?.repoId === 'string' ? input.repoId.trim() : ''

    if (!repoId) {
      throw new Error('Invalid workspace selection.')
    }

    const repo = await convexRepoStore.getRepoForExecution(repoId)
    const localTrackedRepo = localConfigStore
      ? (await localConfigStore.read()).trackedWorkspaces.find(
          (currentRepo) => currentRepo.repoId === repo.id
        )
      : null
    const repoWithLocalTracking = localTrackedRepo
      ? {
          ...repo,
          sourceRepoPath: localTrackedRepo.sourceRepoPath,
          workspaceBranchName: localTrackedRepo.workspaceBranchName ?? repo.workspaceBranchName,
          workspaceProcesses: localTrackedRepo.workspaceProcesses
        }
      : repo

    return deleteWorkspaceForRepo({
      repo: repoWithLocalTracking,
      softDeleteRepo: async () => {
        await convexRepoStore!.softDeleteRepo(repo.id)
        await localConfigStore?.forgetTrackedWorkspace(repo.id).catch(() => undefined)

        return {
          selectedRepoId: repo.sourceRepoId ?? null
        }
      }
    })
  })
  ipcMain.handle(IPC_CHANNELS.runAgent, async (event, input) => {
    if (!agentRunner) {
      throw new Error('Agent runner is unavailable.')
    }

    return agentRunner.run(input, event.sender)
  })
  ipcMain.handle(IPC_CHANNELS.cancelAgent, (_, input) => {
    if (!agentRunner) {
      throw new Error('Agent runner is unavailable.')
    }

    return agentRunner.cancel(input)
  })

  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (hasCompletedQuitCleanup) {
    return
  }

  event.preventDefault()

  if (!quitCleanupPromise) {
    quitCleanupPromise = cleanupBeforeQuit()
      .catch((error) => {
        console.error('Failed to clean up workspace processes before quit.', error)
      })
      .finally(() => {
        hasCompletedQuitCleanup = true
        quitCleanupPromise = null
        app.quit()
      })
  }
})
