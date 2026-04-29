import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DeskbinderApi } from '../shared/ipc'

const api: DeskbinderApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  getVersions: () => ipcRenderer.invoke(IPC_CHANNELS.getVersions),
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickFolder),
  getLocalConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getLocalConfig),
  createRepo: (input) => ipcRenderer.invoke(IPC_CHANNELS.createRepo, input),
  updateRepo: (repo) => ipcRenderer.invoke(IPC_CHANNELS.updateRepo, repo),
  updateAppSettings: (autoRunEnabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateAppSettings, autoRunEnabled),
  runWorkspaceScript: (input) => ipcRenderer.invoke(IPC_CHANNELS.runWorkspaceScript, input),
  deleteWorkspace: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteWorkspace, input)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(globalThis as typeof globalThis & { api: DeskbinderApi }).api = api
}
