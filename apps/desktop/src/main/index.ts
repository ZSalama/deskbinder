import { app, shell, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { AppVersions, FolderPickResult } from '@deskbinder/shared/ipc'
import type { RunWorkspaceScriptResponse } from '@deskbinder/shared/deskbinder'
import { LocalConfigStore } from './services/localConfig'
import { createRendererServer, type RendererServer } from './services/rendererServer'
import { deleteWorkspace } from './services/deleteWorkspace'
import {
  collectTrackedWorkspaceProcesses,
  terminateTrackedWorkspaceProcesses
} from './services/processTracking'
import { AgentRunner } from './services/agentRunner'
import { buildRepoSyncMetadata } from './services/repoSyncMetadata'
import { runWorkspaceScript } from './services/workspaceScript'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import icon from '../../resources/icon.png?asset'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])
const WORKSPACE_SCRIPT_CONCURRENCY_FAILURE_STEP = 'concurrency_guard'

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
let agentRunner: AgentRunner | null = null
let activeWorkspaceScriptRun: Promise<RunWorkspaceScriptResponse> | null = null
let hasCompletedQuitCleanup = false
let quitCleanupPromise: Promise<void> | null = null

function getStringInput(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') {
    return ''
  }

  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
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
    const reposWithTrackedProcesses = (await localConfigStore.read()).repos.filter(
      (repo) => !repo.deleted
    )
    const repoIdsToClear = reposWithTrackedProcesses
      .filter((repo) => (repo.workspaceProcesses?.length ?? 0) > 0)
      .map((repo) => repo.id)

    await Promise.all(
      reposWithTrackedProcesses.map(async (repo) => {
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

async function handleRunWorkspaceScript(input: unknown): Promise<RunWorkspaceScriptResponse> {
  if (!localConfigStore) {
    throw new Error('Local config store is unavailable.')
  }

  const configStore = localConfigStore
  const repoId = getStringInput(input, 'repoId')
  const branchName = getStringInput(input, 'branchName')
  const currentConfig = await configStore.read()
  const sourceRepo = currentConfig.repos.find((repo) => repo.id === repoId)

  if (!sourceRepo) {
    return {
      config: currentConfig,
      selectedRepoId: null,
      result: {
        ok: false,
        agentRunnable: false,
        branchName,
        failureStep: 'repo_lookup',
        errorMessage: 'Selected repo is no longer configured.'
      }
    }
  }

  const result = await runWorkspaceScript({
    branchName,
    repo: sourceRepo
  })

  if (result.ok && result.agentRunnable && result.workspacePath) {
    try {
      const registration = await configStore.registerWorkspaceRepo(
        sourceRepo,
        result.workspacePath,
        result.workspaceName,
        {
          branchName: result.branchName,
          processes: await collectTrackedWorkspaceProcesses(
            result.workspacePath,
            [result.processes?.dev, result.processes?.convex].filter(
              (pid): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 1
            )
          )
        }
      )

      return {
        config: registration.config,
        selectedRepoId: registration.repoId,
        result
      }
    } catch (error) {
      return {
        config: await configStore.read(),
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
    config: currentConfig,
    selectedRepoId: sourceRepo.id,
    result
  }
}

async function createWindow(): Promise<void> {
  const rendererUrl = is.dev
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
  agentRunner = new AgentRunner(localConfigStore, app.getPath('userData'))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(IPC_CHANNELS.ping, () => 'pong')
  ipcMain.handle(IPC_CHANNELS.getVersions, () => getAppVersions())
  ipcMain.handle(IPC_CHANNELS.pickFolder, (event) => {
    return pickFolder(BrowserWindow.fromWebContents(event.sender))
  })
  ipcMain.handle(IPC_CHANNELS.getLocalConfig, async () => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    return localConfigStore.read()
  })
  ipcMain.handle(IPC_CHANNELS.createRepo, async (_, input) => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    return localConfigStore.createRepo(input)
  })
  ipcMain.handle(IPC_CHANNELS.updateRepo, async (_, repo) => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    return localConfigStore.updateRepo(repo)
  })
  ipcMain.handle(IPC_CHANNELS.updateAppSettings, async (_, autoRunEnabled) => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    if (typeof autoRunEnabled !== 'boolean') {
      throw new Error('Invalid app settings.')
    }

    return localConfigStore.updateAppSettings(autoRunEnabled)
  })
  ipcMain.handle(IPC_CHANNELS.getRepoSyncMetadata, async () => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    return buildRepoSyncMetadata(await localConfigStore.read())
  })
  ipcMain.handle(IPC_CHANNELS.runWorkspaceScript, async (_, input) => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    if (activeWorkspaceScriptRun) {
      const currentConfig = await localConfigStore.read()
      const branchName = getStringInput(input, 'branchName')

      return {
        config: currentConfig,
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
  ipcMain.handle(IPC_CHANNELS.deleteWorkspace, async (_, input) => {
    if (!localConfigStore) {
      throw new Error('Local config store is unavailable.')
    }

    const repoId = typeof input?.repoId === 'string' ? input.repoId.trim() : ''

    if (!repoId) {
      throw new Error('Invalid workspace selection.')
    }

    return deleteWorkspace({
      localConfigStore,
      repoId
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
