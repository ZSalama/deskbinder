import { contextBridge, ipcRenderer } from 'electron'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { IPC_CHANNELS } from '../shared/ipcChannels'

const api: DeskbinderApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  getVersions: () => ipcRenderer.invoke(IPC_CHANNELS.getVersions),
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickFolder),
  getLocalConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getLocalConfig),
  createRepo: (input) => ipcRenderer.invoke(IPC_CHANNELS.createRepo, input),
  updateRepo: (repo) => ipcRenderer.invoke(IPC_CHANNELS.updateRepo, repo),
  updateAppSettings: (autoRunEnabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateAppSettings, autoRunEnabled),
  getRepoSyncMetadata: () => ipcRenderer.invoke(IPC_CHANNELS.getRepoSyncMetadata),
  runWorkspaceScript: (input) => ipcRenderer.invoke(IPC_CHANNELS.runWorkspaceScript, input),
  deleteWorkspace: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteWorkspace, input),
  runAgent: (input) => ipcRenderer.invoke(IPC_CHANNELS.runAgent, input),
  cancelAgent: (input) => ipcRenderer.invoke(IPC_CHANNELS.cancelAgent, input),
  onAgentEvent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      handler(payload as Parameters<typeof handler>[0])
    }

    ipcRenderer.on(IPC_CHANNELS.agentEvent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, listener)
  }
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
