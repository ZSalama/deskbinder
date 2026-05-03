export const IPC_CHANNELS = {
  ping: 'v1.system.ping',
  getVersions: 'v1.system.getVersions',
  pickFolder: 'v1.dialog.pickFolder',
  getLocalConfig: 'v1.config.getLocalConfig',
  createRepo: 'v1.config.createRepo',
  updateRepo: 'v1.config.updateRepo',
  updateAppSettings: 'v1.config.updateAppSettings',
  getRepoSyncMetadata: 'v1.repo.syncMetadata.get',
  runWorkspaceScript: 'v1.workspace.runScript',
  deleteWorkspace: 'v1.workspace.delete',
  runAgent: 'v1.agent.run',
  cancelAgent: 'v1.agent.cancel',
  agentEvent: 'v1.agent.event'
} as const
