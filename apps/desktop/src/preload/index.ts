import { contextBridge, ipcRenderer } from 'electron'
import type { DeskbinderApi } from '@deskbinder/shared/ipc'
import { IPC_CHANNELS } from '../shared/ipcChannels'

const api: DeskbinderApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  getVersions: () => ipcRenderer.invoke(IPC_CHANNELS.getVersions),
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickFolder),
  setConvexSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.setConvexSession, input),
  clearConvexSession: () => ipcRenderer.invoke(IPC_CHANNELS.clearConvexSession),
  getDeviceConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getDeviceConfig),
  createRemoteRepo: (input) => ipcRenderer.invoke(IPC_CHANNELS.createRemoteRepo, input),
  updateRemoteRepoSettings: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateRemoteRepoSettings, input),
  syncRepoStates: () => ipcRenderer.invoke(IPC_CHANNELS.syncRepoStates),
  runWorkspaceScript: (input) => ipcRenderer.invoke(IPC_CHANNELS.runWorkspaceScript, input),
  runWorkspaceScripts: (input) => ipcRenderer.invoke(IPC_CHANNELS.runWorkspaceScripts, input),
  deleteWorkspace: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteWorkspace, input),
  getDevEnvironmentStatus: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.getDevEnvironmentStatus, input),
  openDevEnvironment: (input) => ipcRenderer.invoke(IPC_CHANNELS.openDevEnvironment, input),
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
