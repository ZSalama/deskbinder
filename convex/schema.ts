import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const agentJobStatus = v.union(
  v.literal('queued'),
  v.literal('claimed'),
  v.literal('setup_running'),
  v.literal('setup_failed'),
  v.literal('agent_running'),
  v.literal('agent_failed'),
  v.literal('agent_succeeded'),
  v.literal('cancelled'),
  v.literal('interrupted')
)

const workerStatus = v.union(v.literal('online'), v.literal('busy'), v.literal('offline'))

const agentExecutable = v.union(v.literal('codex'), v.literal('claude'))

const repoReadinessStatus = v.union(
  v.literal('ready'),
  v.literal('invalid'),
  v.literal('dirty'),
  v.literal('missing_script'),
  v.literal('missing_repo'),
  v.literal('error')
)

const branchRequestStatus = v.union(
  v.literal('queued'),
  v.literal('claimed'),
  v.literal('succeeded'),
  v.literal('failed')
)

const humanInputRequestStatus = v.union(
  v.literal('pending'),
  v.literal('answered'),
  v.literal('claimed'),
  v.literal('cancelled')
)

export default defineSchema({
  desktopWorkers: defineTable({
    ownerTokenIdentifier: v.string(),
    workerId: v.string(),
    name: v.string(),
    hiddenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index('by_ownerTokenIdentifier_and_workerId', ['ownerTokenIdentifier', 'workerId']),

  desktopWorkerHeartbeats: defineTable({
    ownerTokenIdentifier: v.string(),
    desktopWorkerId: v.id('desktopWorkers'),
    workerId: v.string(),
    status: workerStatus,
    lastSeenAt: v.number(),
    updatedAt: v.number()
  })
    .index('by_ownerTokenIdentifier_and_workerId', ['ownerTokenIdentifier', 'workerId'])
    .index('by_desktopWorkerId', ['desktopWorkerId']),

  desktopRepoConfigs: defineTable({
    ownerTokenIdentifier: v.string(),
    workerId: v.string(),
    localRepoId: v.string(),
    sourceLocalRepoId: v.optional(v.string()),
    name: v.string(),
    repoPath: v.string(),
    workspaceScriptPath: v.string(),
    defaultScriptArgs: v.optional(v.string()),
    agentExecutable,
    workspaceBranchName: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index('by_ownerTokenIdentifier_and_workerId', ['ownerTokenIdentifier', 'workerId'])
    .index('by_ownerTokenIdentifier_and_localRepoId', ['ownerTokenIdentifier', 'localRepoId'])
    .index('by_ownerTokenIdentifier_and_repoPath', ['ownerTokenIdentifier', 'repoPath'])
    .index('by_ownerTokenIdentifier_and_workerId_and_localRepoId', [
      'ownerTokenIdentifier',
      'workerId',
      'localRepoId'
    ])
    .index('by_ownerTokenIdentifier_and_workerId_and_repoPath', [
      'ownerTokenIdentifier',
      'workerId',
      'repoPath'
    ]),

  desktopRepoStates: defineTable({
    ownerTokenIdentifier: v.string(),
    workerId: v.string(),
    localRepoId: v.string(),
    currentBranch: v.string(),
    isValid: v.boolean(),
    readinessStatus: repoReadinessStatus,
    readinessMessage: v.optional(v.string()),
    lastSeenAt: v.number(),
    updatedAt: v.number()
  })
    .index('by_ownerTokenIdentifier_and_workerId', ['ownerTokenIdentifier', 'workerId'])
    .index('by_ownerTokenIdentifier_and_workerId_and_localRepoId', [
      'ownerTokenIdentifier',
      'workerId',
      'localRepoId'
    ]),

  branchRequests: defineTable({
    ownerTokenIdentifier: v.string(),
    targetWorkerId: v.string(),
    sourceLocalRepoId: v.string(),
    branchName: v.string(),
    scriptArgs: v.optional(v.string()),
    status: branchRequestStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    resultLocalRepoId: v.optional(v.string()),
    errorMessage: v.optional(v.string())
  }).index('by_ownerTokenIdentifier_and_status_and_targetWorkerId', [
    'ownerTokenIdentifier',
    'status',
    'targetWorkerId'
  ]),

  agentJobs: defineTable({
    ownerTokenIdentifier: v.string(),
    targetWorkerId: v.string(),
    targetRepoId: v.string(),
    promptText: v.string(),
    status: agentJobStatus,
    branchName: v.optional(v.string()),
    runId: v.optional(v.string()),
    codexThreadId: v.optional(v.string()),
    pendingHumanInputRequestId: v.optional(v.id('agentJobHumanInputRequests')),
    createdAt: v.number(),
    updatedAt: v.number(),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    resultSummary: v.optional(v.string())
  })
    .index('by_ownerTokenIdentifier_and_status_and_targetWorkerId', [
      'ownerTokenIdentifier',
      'status',
      'targetWorkerId'
    ])
    .index('by_ownerTokenIdentifier_and_targetWorkerId_and_targetRepoId', [
      'ownerTokenIdentifier',
      'targetWorkerId',
      'targetRepoId'
    ])
    .index('by_ownerTokenIdentifier_and_targetWorkerId_and_targetRepoId_and_status', [
      'ownerTokenIdentifier',
      'targetWorkerId',
      'targetRepoId',
      'status'
    ]),

  agentJobAttempts: defineTable({
    ownerTokenIdentifier: v.string(),
    jobId: v.id('agentJobs'),
    workerId: v.string(),
    status: agentJobStatus,
    runId: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    exitCode: v.optional(v.number()),
    signal: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    resultSummary: v.optional(v.string())
  }).index('by_jobId', ['jobId']),

  agentJobHumanInputRequests: defineTable({
    ownerTokenIdentifier: v.string(),
    jobId: v.id('agentJobs'),
    attemptId: v.id('agentJobAttempts'),
    workerId: v.string(),
    runId: v.string(),
    codexThreadId: v.optional(v.string()),
    promptText: v.string(),
    status: humanInputRequestStatus,
    responseText: v.optional(v.string()),
    createdAt: v.number(),
    answeredAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number())
  })
    .index('by_ownerTokenIdentifier_and_status_and_workerId', [
      'ownerTokenIdentifier',
      'status',
      'workerId'
    ])
    .index('by_jobId', ['jobId'])
})
