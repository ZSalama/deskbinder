import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

const PROMPT_MAX_CHARACTERS = 100_000
const SUMMARY_MAX_CHARACTERS = 60_000
const ERROR_MAX_CHARACTERS = 2_000
const HUMAN_INPUT_MAX_CHARACTERS = 100_000
const CODEX_THREAD_ID_MAX_CHARACTERS = 200
const QUEUED_JOB_LIMIT = 5
const RECENT_JOB_LIMIT = 20

const desktopCompletionStatusValidator = v.union(
  v.literal('succeeded'),
  v.literal('failed'),
  v.literal('cancelled'),
  v.literal('timed_out'),
  v.literal('interrupted')
)

type AgentJobStatus =
  | 'queued'
  | 'claimed'
  | 'setup_running'
  | 'setup_failed'
  | 'agent_running'
  | 'agent_failed'
  | 'agent_succeeded'
  | 'cancelled'
  | 'interrupted'

type DesktopCompletionStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted'

type PendingHumanInputRequestSummary = {
  requestId: Id<'agentJobHumanInputRequests'>
  promptText: string
  createdAt: number
}

type AgentJobSummary = {
  jobId: Id<'agentJobs'>
  targetWorkerId: string
  targetRepoId: string
  promptText: string
  status: AgentJobStatus
  branchName?: string
  runId?: string
  codexThreadId?: string
  pendingHumanInputRequest?: PendingHumanInputRequestSummary
  createdAt: number
  updatedAt: number
  claimedAt?: number
  completedAt?: number
  errorMessage?: string
  resultSummary?: string
}

type ClaimedAgentJob = AgentJobSummary & {
  attemptId: Id<'agentJobAttempts'>
}

type AnsweredHumanInputRequest = PendingHumanInputRequestSummary & {
  jobId: Id<'agentJobs'>
  targetRepoId: string
  responseText: string
}

type ClaimedHumanInputRequestJob = ClaimedAgentJob & {
  humanInputRequestId: Id<'agentJobHumanInputRequests'>
  humanInputResponseText: string
  codexThreadId: string
}

async function requireOwnerTokenIdentifier(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    throw new Error('Not authenticated')
  }

  return identity.tokenIdentifier
}

async function getDesktopWorker(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  workerId: string
): Promise<Doc<'desktopWorkers'> | null> {
  return await ctx.db
    .query('desktopWorkers')
    .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
      q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('workerId', workerId)
    )
    .first()
}

async function getDesktopRepo(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  workerId: string,
  localRepoId: string
): Promise<Doc<'desktopRepoConfigs'> | null> {
  const repo = await ctx.db
    .query('desktopRepoConfigs')
    .withIndex('by_ownerTokenIdentifier_and_workerId_and_localRepoId', (q) =>
      q
        .eq('ownerTokenIdentifier', ownerTokenIdentifier)
        .eq('workerId', workerId)
        .eq('localRepoId', localRepoId)
    )
    .first()

  return repo && !repo.deletedAt ? repo : null
}

async function getDesktopRepoState(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  workerId: string,
  localRepoId: string
): Promise<Doc<'desktopRepoStates'> | null> {
  return await ctx.db
    .query('desktopRepoStates')
    .withIndex('by_ownerTokenIdentifier_and_workerId_and_localRepoId', (q) =>
      q
        .eq('ownerTokenIdentifier', ownerTokenIdentifier)
        .eq('workerId', workerId)
        .eq('localRepoId', localRepoId)
    )
    .first()
}

function sanitizeRequiredString(value: string, label: string, maxCharacters: number): string {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    throw new Error(`${label} is required.`)
  }

  if (trimmedValue.length > maxCharacters) {
    throw new Error(`${label} is too long.`)
  }

  return trimmedValue
}

function sanitizeOptionalString(
  value: string | undefined,
  maxCharacters: number
): string | undefined {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return undefined
  }

  return trimmedValue.slice(0, maxCharacters)
}

function toFinalAgentStatus(status: DesktopCompletionStatus): AgentJobStatus {
  switch (status) {
    case 'succeeded':
      return 'agent_succeeded'
    case 'cancelled':
      return 'cancelled'
    case 'timed_out':
    case 'failed':
      return 'agent_failed'
    case 'interrupted':
      return 'interrupted'
  }
}

function isRunnableRepoState(repoState: Doc<'desktopRepoStates'> | null): boolean {
  return Boolean(repoState?.isValid || repoState?.readinessStatus === 'dirty')
}

async function getPendingHumanInputRequestSummary(
  ctx: QueryCtx | MutationCtx,
  job: Doc<'agentJobs'>
): Promise<PendingHumanInputRequestSummary | undefined> {
  if (!job.pendingHumanInputRequestId) {
    return undefined
  }

  const request = await ctx.db.get(job.pendingHumanInputRequestId)

  if (!request || request.status !== 'pending') {
    return undefined
  }

  return {
    requestId: request._id,
    promptText: request.promptText,
    createdAt: request.createdAt
  }
}

async function toAgentJobSummary(
  ctx: QueryCtx | MutationCtx,
  job: Doc<'agentJobs'>
): Promise<AgentJobSummary> {
  return {
    jobId: job._id,
    targetWorkerId: job.targetWorkerId,
    targetRepoId: job.targetRepoId,
    promptText: job.promptText,
    status: job.status,
    branchName: job.branchName,
    runId: job.runId,
    codexThreadId: job.codexThreadId,
    pendingHumanInputRequest: await getPendingHumanInputRequestSummary(ctx, job),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    claimedAt: job.claimedAt,
    completedAt: job.completedAt,
    errorMessage: job.errorMessage,
    resultSummary: job.resultSummary
  }
}

async function requireOwnedJob(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  jobId: Id<'agentJobs'>,
  workerId: string
): Promise<Doc<'agentJobs'>> {
  const job = await ctx.db.get(jobId)

  if (
    !job ||
    job.ownerTokenIdentifier !== ownerTokenIdentifier ||
    job.targetWorkerId !== workerId
  ) {
    throw new Error('Agent job is unavailable.')
  }

  return job
}

async function requireOwnedAttempt(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  attemptId: Id<'agentJobAttempts'>,
  jobId: Id<'agentJobs'>,
  workerId: string
): Promise<Doc<'agentJobAttempts'>> {
  const attempt = await ctx.db.get(attemptId)

  if (
    !attempt ||
    attempt.ownerTokenIdentifier !== ownerTokenIdentifier ||
    attempt.jobId !== jobId ||
    attempt.workerId !== workerId
  ) {
    throw new Error('Agent job attempt is unavailable.')
  }

  return attempt
}

export const createAgentJob = mutation({
  args: {
    targetWorkerId: v.string(),
    targetRepoId: v.string(),
    promptText: v.string()
  },
  handler: async (ctx, args): Promise<AgentJobSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const worker = await getDesktopWorker(ctx, ownerTokenIdentifier, args.targetWorkerId)

    if (!worker) {
      throw new Error('Desktop worker is not registered.')
    }

    const repo = await getDesktopRepo(
      ctx,
      ownerTokenIdentifier,
      args.targetWorkerId,
      args.targetRepoId
    )

    if (!repo) {
      throw new Error('Repository is unavailable.')
    }

    const repoState = await getDesktopRepoState(
      ctx,
      ownerTokenIdentifier,
      args.targetWorkerId,
      args.targetRepoId
    )

    if (!repoState || !isRunnableRepoState(repoState)) {
      throw new Error(repoState?.readinessMessage ?? 'Repository is not ready for agent jobs.')
    }

    const now = Date.now()
    const jobId = await ctx.db.insert('agentJobs', {
      ownerTokenIdentifier,
      targetWorkerId: args.targetWorkerId,
      targetRepoId: args.targetRepoId,
      promptText: sanitizeRequiredString(args.promptText, 'Prompt text', PROMPT_MAX_CHARACTERS),
      status: 'queued',
      branchName: repo.workspaceBranchName ?? repoState.currentBranch,
      createdAt: now,
      updatedAt: now
    })
    const job = await ctx.db.get(jobId)

    if (!job) {
      throw new Error('Unable to create agent job.')
    }

    return await toAgentJobSummary(ctx, job)
  }
})

export const listQueuedAgentJobs = query({
  args: {
    workerId: v.string()
  },
  handler: async (ctx, args): Promise<AgentJobSummary[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const worker = await getDesktopWorker(ctx, ownerTokenIdentifier, args.workerId)

    if (!worker) {
      return []
    }

    const jobs = await ctx.db
      .query('agentJobs')
      .withIndex('by_ownerTokenIdentifier_and_status_and_targetWorkerId', (q) =>
        q
          .eq('ownerTokenIdentifier', ownerTokenIdentifier)
          .eq('status', 'queued')
          .eq('targetWorkerId', args.workerId)
      )
      .take(QUEUED_JOB_LIMIT)

    return await Promise.all(jobs.map((job) => toAgentJobSummary(ctx, job)))
  }
})

export const listRecentAgentJobs = query({
  args: {
    targetWorkerId: v.string(),
    targetRepoId: v.string()
  },
  handler: async (ctx, args): Promise<AgentJobSummary[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const jobs = await ctx.db
      .query('agentJobs')
      .withIndex('by_ownerTokenIdentifier_and_targetWorkerId_and_targetRepoId', (q) =>
        q
          .eq('ownerTokenIdentifier', ownerTokenIdentifier)
          .eq('targetWorkerId', args.targetWorkerId)
          .eq('targetRepoId', args.targetRepoId)
      )
      .order('desc')
      .take(RECENT_JOB_LIMIT)

    return await Promise.all(jobs.map((job) => toAgentJobSummary(ctx, job)))
  }
})

export const claimAgentJob = mutation({
  args: {
    jobId: v.id('agentJobs'),
    workerId: v.string()
  },
  handler: async (ctx, args): Promise<ClaimedAgentJob | null> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const job = await requireOwnedJob(ctx, ownerTokenIdentifier, args.jobId, args.workerId)

    if (job.status !== 'queued') {
      return null
    }

    const now = Date.now()
    const attemptId = await ctx.db.insert('agentJobAttempts', {
      ownerTokenIdentifier,
      jobId: job._id,
      workerId: args.workerId,
      status: 'claimed',
      startedAt: now
    })

    await ctx.db.patch(job._id, {
      status: 'claimed',
      claimedAt: now,
      updatedAt: now
    })

    const claimedJob = await ctx.db.get(job._id)

    if (!claimedJob) {
      throw new Error('Agent job is unavailable.')
    }

    return {
      ...(await toAgentJobSummary(ctx, claimedJob)),
      attemptId
    }
  }
})

export const markAgentJobRunning = mutation({
  args: {
    jobId: v.id('agentJobs'),
    attemptId: v.id('agentJobAttempts'),
    workerId: v.string(),
    runId: v.string()
  },
  handler: async (ctx, args): Promise<AgentJobSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const job = await requireOwnedJob(ctx, ownerTokenIdentifier, args.jobId, args.workerId)
    const attempt = await requireOwnedAttempt(
      ctx,
      ownerTokenIdentifier,
      args.attemptId,
      args.jobId,
      args.workerId
    )

    if (job.status !== 'claimed' || attempt.status !== 'claimed') {
      throw new Error('Agent job is not ready to run.')
    }

    const now = Date.now()
    const runId = sanitizeRequiredString(args.runId, 'Run id', 200)

    await ctx.db.patch(job._id, {
      status: 'agent_running',
      runId,
      updatedAt: now
    })
    await ctx.db.patch(attempt._id, {
      status: 'agent_running',
      runId
    })

    const runningJob = await ctx.db.get(job._id)

    if (!runningJob) {
      throw new Error('Agent job is unavailable.')
    }

    return await toAgentJobSummary(ctx, runningJob)
  }
})

export const completeAgentJob = mutation({
  args: {
    jobId: v.id('agentJobs'),
    attemptId: v.id('agentJobAttempts'),
    workerId: v.string(),
    status: desktopCompletionStatusValidator,
    exitCode: v.optional(v.number()),
    signal: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    resultSummary: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<AgentJobSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const job = await requireOwnedJob(ctx, ownerTokenIdentifier, args.jobId, args.workerId)
    const attempt = await requireOwnedAttempt(
      ctx,
      ownerTokenIdentifier,
      args.attemptId,
      args.jobId,
      args.workerId
    )

    if (job.status !== 'claimed' && job.status !== 'agent_running') {
      throw new Error('Agent job is not active.')
    }

    if (attempt.status !== 'claimed' && attempt.status !== 'agent_running') {
      throw new Error('Agent job attempt is not active.')
    }

    const now = Date.now()
    const finalStatus = toFinalAgentStatus(args.status)
    const errorMessage =
      args.status === 'timed_out'
        ? 'Codex timed out.'
        : sanitizeOptionalString(args.errorMessage, ERROR_MAX_CHARACTERS)
    const resultSummary = sanitizeOptionalString(args.resultSummary, SUMMARY_MAX_CHARACTERS)
    const signal = sanitizeOptionalString(args.signal, 120)

    await ctx.db.patch(job._id, {
      status: finalStatus,
      completedAt: now,
      updatedAt: now,
      ...(errorMessage ? { errorMessage } : {}),
      ...(resultSummary ? { resultSummary } : {})
    })
    await ctx.db.patch(attempt._id, {
      status: finalStatus,
      completedAt: now,
      ...(typeof args.exitCode === 'number' ? { exitCode: args.exitCode } : {}),
      ...(signal ? { signal } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(resultSummary ? { resultSummary } : {})
    })

    const completedJob = await ctx.db.get(job._id)

    if (!completedJob) {
      throw new Error('Agent job is unavailable.')
    }

    return await toAgentJobSummary(ctx, completedJob)
  }
})

export const interruptAgentJob = mutation({
  args: {
    jobId: v.id('agentJobs'),
    attemptId: v.id('agentJobAttempts'),
    workerId: v.string(),
    runId: v.string(),
    codexThreadId: v.optional(v.string()),
    promptText: v.string(),
    resultSummary: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<AgentJobSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const job = await requireOwnedJob(ctx, ownerTokenIdentifier, args.jobId, args.workerId)
    const attempt = await requireOwnedAttempt(
      ctx,
      ownerTokenIdentifier,
      args.attemptId,
      args.jobId,
      args.workerId
    )

    if (job.status !== 'claimed' && job.status !== 'agent_running') {
      throw new Error('Agent job is not active.')
    }

    if (attempt.status !== 'claimed' && attempt.status !== 'agent_running') {
      throw new Error('Agent job attempt is not active.')
    }

    const now = Date.now()
    const runId = sanitizeRequiredString(args.runId, 'Run id', 200)
    const promptText = sanitizeRequiredString(
      args.promptText,
      'Human input prompt',
      HUMAN_INPUT_MAX_CHARACTERS
    )
    const codexThreadId = sanitizeOptionalString(args.codexThreadId, CODEX_THREAD_ID_MAX_CHARACTERS)
    const resultSummary = sanitizeOptionalString(args.resultSummary, SUMMARY_MAX_CHARACTERS)
    const requestId = await ctx.db.insert('agentJobHumanInputRequests', {
      ownerTokenIdentifier,
      jobId: job._id,
      attemptId: attempt._id,
      workerId: args.workerId,
      runId,
      ...(codexThreadId ? { codexThreadId } : {}),
      promptText,
      status: 'pending',
      createdAt: now
    })

    await ctx.db.patch(job._id, {
      status: 'interrupted',
      runId,
      ...(codexThreadId ? { codexThreadId } : {}),
      pendingHumanInputRequestId: requestId,
      updatedAt: now,
      ...(resultSummary ? { resultSummary } : {})
    })
    await ctx.db.patch(attempt._id, {
      status: 'interrupted',
      completedAt: now,
      ...(resultSummary ? { resultSummary } : {})
    })

    const interruptedJob = await ctx.db.get(job._id)

    if (!interruptedJob) {
      throw new Error('Agent job is unavailable.')
    }

    return await toAgentJobSummary(ctx, interruptedJob)
  }
})

export const answerHumanInputRequest = mutation({
  args: {
    requestId: v.id('agentJobHumanInputRequests'),
    responseText: v.string()
  },
  handler: async (ctx, args): Promise<PendingHumanInputRequestSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const request = await ctx.db.get(args.requestId)

    if (!request || request.ownerTokenIdentifier !== ownerTokenIdentifier) {
      throw new Error('Human input request is unavailable.')
    }

    if (request.status !== 'pending') {
      throw new Error('Human input request has already been handled.')
    }

    const responseText = sanitizeRequiredString(
      args.responseText,
      'Response',
      HUMAN_INPUT_MAX_CHARACTERS
    )
    const now = Date.now()

    await ctx.db.patch(request._id, {
      status: 'answered',
      responseText,
      answeredAt: now
    })

    return {
      requestId: request._id,
      promptText: request.promptText,
      createdAt: request.createdAt
    }
  }
})

export const listAnsweredHumanInputRequests = query({
  args: {
    workerId: v.string()
  },
  handler: async (ctx, args): Promise<AnsweredHumanInputRequest[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const worker = await getDesktopWorker(ctx, ownerTokenIdentifier, args.workerId)

    if (!worker) {
      return []
    }

    const requests = await ctx.db
      .query('agentJobHumanInputRequests')
      .withIndex('by_ownerTokenIdentifier_and_status_and_workerId', (q) =>
        q
          .eq('ownerTokenIdentifier', ownerTokenIdentifier)
          .eq('status', 'answered')
          .eq('workerId', args.workerId)
      )
      .take(QUEUED_JOB_LIMIT)
    const result: AnsweredHumanInputRequest[] = []

    for (const request of requests) {
      const job = await ctx.db.get(request.jobId)

      if (
        !job ||
        job.ownerTokenIdentifier !== ownerTokenIdentifier ||
        job.targetWorkerId !== args.workerId ||
        job.status !== 'interrupted' ||
        !request.responseText
      ) {
        continue
      }

      result.push({
        requestId: request._id,
        jobId: request.jobId,
        targetRepoId: job.targetRepoId,
        promptText: request.promptText,
        responseText: request.responseText,
        createdAt: request.createdAt
      })
    }

    return result
  }
})

export const claimAnsweredHumanInputRequest = mutation({
  args: {
    requestId: v.id('agentJobHumanInputRequests'),
    workerId: v.string()
  },
  handler: async (ctx, args): Promise<ClaimedHumanInputRequestJob | null> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const request = await ctx.db.get(args.requestId)

    if (
      !request ||
      request.ownerTokenIdentifier !== ownerTokenIdentifier ||
      request.workerId !== args.workerId
    ) {
      throw new Error('Human input request is unavailable.')
    }

    if (request.status !== 'answered') {
      return null
    }

    const job = await requireOwnedJob(ctx, ownerTokenIdentifier, request.jobId, args.workerId)

    if (job.status !== 'interrupted') {
      return null
    }

    const responseText = sanitizeRequiredString(
      request.responseText ?? '',
      'Response',
      HUMAN_INPUT_MAX_CHARACTERS
    )
    const codexThreadId = sanitizeRequiredString(
      request.codexThreadId ?? job.codexThreadId ?? '',
      'Codex thread id',
      CODEX_THREAD_ID_MAX_CHARACTERS
    )
    const now = Date.now()
    const attemptId = await ctx.db.insert('agentJobAttempts', {
      ownerTokenIdentifier,
      jobId: job._id,
      workerId: args.workerId,
      status: 'claimed',
      startedAt: now
    })

    await ctx.db.patch(request._id, {
      status: 'claimed',
      claimedAt: now
    })
    await ctx.db.patch(job._id, {
      status: 'claimed',
      claimedAt: now,
      updatedAt: now,
      pendingHumanInputRequestId: undefined
    })

    const claimedJob = await ctx.db.get(job._id)

    if (!claimedJob) {
      throw new Error('Agent job is unavailable.')
    }

    return {
      ...(await toAgentJobSummary(ctx, claimedJob)),
      attemptId,
      humanInputRequestId: request._id,
      humanInputResponseText: responseText,
      codexThreadId
    }
  }
})
