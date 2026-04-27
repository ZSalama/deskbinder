import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DeskbinderApi } from '../shared/ipc'

const api: DeskbinderApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  getVersions: () => ipcRenderer.invoke(IPC_CHANNELS.getVersions),
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickFolder)
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
