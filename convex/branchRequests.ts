import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

type BranchRequestSummary = {
  requestId: Id<'branchRequests'>
  targetWorkerId: string
  sourceLocalRepoId: string
  branchName: string
  scriptArgs?: string
  status: 'queued' | 'claimed' | 'succeeded' | 'failed'
  createdAt: number
  updatedAt: number
  claimedAt?: number
  completedAt?: number
  resultLocalRepoId?: string
  errorMessage?: string
}

const MAX_BRANCH_REQUESTS_PER_BATCH = 5
const SCRIPT_ARGS_MAX_CHARACTERS = 4_000

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

function sanitizeBranchName(branchName: string): string {
  const trimmedBranchName = branchName.trim()

  if (!trimmedBranchName || trimmedBranchName.length > 160) {
    throw new Error('Branch name is required.')
  }

  if (
    Array.from(trimmedBranchName).some((character) => {
      const codePoint = character.codePointAt(0)

      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
    })
  ) {
    throw new Error('Branch name contains unsupported characters.')
  }

  return trimmedBranchName
}

function sanitizeScriptArgs(scriptArgs: string | undefined): string | undefined {
  if (scriptArgs === undefined) {
    return undefined
  }

  if (scriptArgs.length > SCRIPT_ARGS_MAX_CHARACTERS) {
    throw new Error('Script args are too long.')
  }

  return scriptArgs
}

function toBranchRequestSummary(request: Doc<'branchRequests'>): BranchRequestSummary {
  return {
    requestId: request._id,
    targetWorkerId: request.targetWorkerId,
    sourceLocalRepoId: request.sourceLocalRepoId,
    branchName: request.branchName,
    scriptArgs: request.scriptArgs,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    claimedAt: request.claimedAt,
    completedAt: request.completedAt,
    resultLocalRepoId: request.resultLocalRepoId,
    errorMessage: request.errorMessage
  }
}

export const createBranchRequest = mutation({
  args: {
    targetWorkerId: v.string(),
    sourceLocalRepoId: v.string(),
    branchName: v.string(),
    scriptArgs: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<BranchRequestSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const worker = await getDesktopWorker(ctx, ownerTokenIdentifier, args.targetWorkerId)

    if (!worker) {
      throw new Error('Desktop worker is not registered.')
    }

    const sourceRepo = await getDesktopRepo(
      ctx,
      ownerTokenIdentifier,
      args.targetWorkerId,
      args.sourceLocalRepoId
    )

    if (!sourceRepo) {
      throw new Error('Source repository is unavailable.')
    }

    if (sourceRepo.sourceLocalRepoId) {
      throw new Error('New branches must be created from the parent repository.')
    }

    const now = Date.now()
    const requestId = await ctx.db.insert('branchRequests', {
      ownerTokenIdentifier,
      targetWorkerId: args.targetWorkerId,
      sourceLocalRepoId: args.sourceLocalRepoId,
      branchName: sanitizeBranchName(args.branchName),
      ...(args.scriptArgs !== undefined ? { scriptArgs: sanitizeScriptArgs(args.scriptArgs) } : {}),
      status: 'queued',
      createdAt: now,
      updatedAt: now
    })
    const request = await ctx.db.get(requestId)

    if (!request) {
      throw new Error('Unable to create branch request.')
    }

    return toBranchRequestSummary(request)
  }
})

export const createBranchRequests = mutation({
  args: {
    targetWorkerId: v.string(),
    sourceLocalRepoId: v.string(),
    requests: v.array(
      v.object({
        branchName: v.string(),
        scriptArgs: v.string()
      })
    )
  },
  handler: async (ctx, args): Promise<BranchRequestSummary[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)

    if (args.requests.length < 1 || args.requests.length > MAX_BRANCH_REQUESTS_PER_BATCH) {
      throw new Error('Create between 1 and 5 workspaces at a time.')
    }

    const worker = await getDesktopWorker(ctx, ownerTokenIdentifier, args.targetWorkerId)

    if (!worker) {
      throw new Error('Desktop worker is not registered.')
    }

    const sourceRepo = await getDesktopRepo(
      ctx,
      ownerTokenIdentifier,
      args.targetWorkerId,
      args.sourceLocalRepoId
    )

    if (!sourceRepo) {
      throw new Error('Source repository is unavailable.')
    }

    if (sourceRepo.sourceLocalRepoId) {
      throw new Error('New branches must be created from the parent repository.')
    }

    const normalizedRequests = args.requests.map((request) => ({
      branchName: sanitizeBranchName(request.branchName),
      scriptArgs: sanitizeScriptArgs(request.scriptArgs) ?? ''
    }))
    const branchNames = new Set<string>()

    for (const request of normalizedRequests) {
      if (branchNames.has(request.branchName)) {
        throw new Error('Branch names must be unique.')
      }

      branchNames.add(request.branchName)
    }

    const now = Date.now()
    const requests: Array<Doc<'branchRequests'>> = []

    for (const request of normalizedRequests) {
      const requestId = await ctx.db.insert('branchRequests', {
        ownerTokenIdentifier,
        targetWorkerId: args.targetWorkerId,
        sourceLocalRepoId: args.sourceLocalRepoId,
        branchName: request.branchName,
        scriptArgs: request.scriptArgs,
        status: 'queued',
        createdAt: now,
        updatedAt: now
      })
      const branchRequest = await ctx.db.get(requestId)

      if (!branchRequest) {
        throw new Error('Unable to create branch requests.')
      }

      requests.push(branchRequest)
    }

    return requests.map(toBranchRequestSummary)
  }
})

export const listQueuedBranchRequests = query({
  args: {
    workerId: v.string()
  },
  handler: async (ctx, args): Promise<BranchRequestSummary[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const worker = await getDesktopWorker(ctx, ownerTokenIdentifier, args.workerId)

    if (!worker) {
      return []
    }

    const requests = await ctx.db
      .query('branchRequests')
      .withIndex('by_ownerTokenIdentifier_and_status_and_targetWorkerId', (q) =>
        q
          .eq('ownerTokenIdentifier', ownerTokenIdentifier)
          .eq('status', 'queued')
          .eq('targetWorkerId', args.workerId)
      )
      .collect()

    return requests
      .sort((first, second) => first.createdAt - second.createdAt)
      .map(toBranchRequestSummary)
  }
})

export const claimBranchRequest = mutation({
  args: {
    requestId: v.id('branchRequests'),
    workerId: v.string()
  },
  handler: async (ctx, args): Promise<BranchRequestSummary | null> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const request = await ctx.db.get(args.requestId)

    if (
      !request ||
      request.ownerTokenIdentifier !== ownerTokenIdentifier ||
      request.targetWorkerId !== args.workerId
    ) {
      throw new Error('Branch request is unavailable.')
    }

    if (request.status !== 'queued') {
      return null
    }

    const now = Date.now()
    await ctx.db.patch(request._id, {
      status: 'claimed',
      claimedAt: now,
      updatedAt: now
    })

    const claimedRequest = await ctx.db.get(request._id)

    if (!claimedRequest) {
      throw new Error('Branch request is unavailable.')
    }

    return toBranchRequestSummary(claimedRequest)
  }
})

export const completeBranchRequest = mutation({
  args: {
    requestId: v.id('branchRequests'),
    workerId: v.string(),
    ok: v.boolean(),
    resultLocalRepoId: v.optional(v.string()),
    errorMessage: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<BranchRequestSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const request = await ctx.db.get(args.requestId)

    if (
      !request ||
      request.ownerTokenIdentifier !== ownerTokenIdentifier ||
      request.targetWorkerId !== args.workerId
    ) {
      throw new Error('Branch request is unavailable.')
    }

    if (request.status !== 'claimed') {
      throw new Error('Branch request is not claimed.')
    }

    const now = Date.now()
    const errorMessage = args.errorMessage?.trim()

    await ctx.db.patch(request._id, {
      status: args.ok ? 'succeeded' : 'failed',
      completedAt: now,
      updatedAt: now,
      ...(args.ok && args.resultLocalRepoId ? { resultLocalRepoId: args.resultLocalRepoId } : {}),
      ...(!args.ok && errorMessage ? { errorMessage } : {})
    })

    const completedRequest = await ctx.db.get(request._id)

    if (!completedRequest) {
      throw new Error('Branch request is unavailable.')
    }

    return toBranchRequestSummary(completedRequest)
  }
})
