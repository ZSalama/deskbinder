export const IPC_CHANNELS = {
  ping: 'v1.system.ping',
  getVersions: 'v1.system.getVersions',
  pickFolder: 'v1.dialog.pickFolder',
  setConvexSession: 'v1.convex.session.set',
  clearConvexSession: 'v1.convex.session.clear',
  getDeviceConfig: 'v1.device.config.get',
  createRemoteRepo: 'v1.repo.create',
  updateRemoteRepoSettings: 'v1.repo.updateSettings',
  syncRepoStates: 'v1.repo.syncStates',
  runWorkspaceScript: 'v1.workspace.runScript',
  runWorkspaceScripts: 'v1.workspace.runScripts',
  deleteWorkspace: 'v1.workspace.delete',
  runAgent: 'v1.agent.run',
  cancelAgent: 'v1.agent.cancel',
  agentEvent: 'v1.agent.event'
} as const
