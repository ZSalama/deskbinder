import { app, shell, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC_CHANNELS, type AppVersions, type FolderPickResult } from '../shared/ipc'
import { createRendererServer, type RendererServer } from './services/rendererServer'
import icon from '../../resources/icon.png?asset'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])

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

async function getProductionRendererUrl(): Promise<URL> {
  if (!rendererServer) {
    rendererServer = await createRendererServer()
  }

  return new URL(rendererServer.origin)
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

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(IPC_CHANNELS.ping, () => 'pong')
  ipcMain.handle(IPC_CHANNELS.getVersions, () => getAppVersions())
  ipcMain.handle(IPC_CHANNELS.pickFolder, (event) => {
    return pickFolder(BrowserWindow.fromWebContents(event.sender))
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

app.on('before-quit', () => {
  if (rendererServer) {
    void rendererServer.close()
    rendererServer = null
  }
})
