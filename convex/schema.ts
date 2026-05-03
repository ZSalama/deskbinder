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

export default defineSchema({
  desktopWorkers: defineTable({
    ownerTokenIdentifier: v.string(),
    workerId: v.string(),
    name: v.string(),
    autoRunEnabled: v.boolean(),
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

  desktopRepos: defineTable({
    ownerTokenIdentifier: v.string(),
    workerId: v.string(),
    localRepoId: v.string(),
    sourceLocalRepoId: v.optional(v.string()),
    name: v.string(),
    currentBranch: v.string(),
    workspaceBranchName: v.optional(v.string()),
    isValid: v.boolean(),
    readinessStatus: repoReadinessStatus,
    readinessMessage: v.optional(v.string()),
    lastSeenAt: v.number(),
    createdAt: v.number(),
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
    createdAt: v.number(),
    updatedAt: v.number(),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string())
  }).index('by_ownerTokenIdentifier_and_status_and_targetWorkerId', [
    'ownerTokenIdentifier',
    'status',
    'targetWorkerId'
  ]),

  agentJobAttempts: defineTable({
    ownerTokenIdentifier: v.string(),
    jobId: v.id('agentJobs'),
    workerId: v.string(),
    status: agentJobStatus,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    exitCode: v.optional(v.number()),
    signal: v.optional(v.string()),
    errorMessage: v.optional(v.string())
  }).index('by_jobId', ['jobId'])
})
