import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

type BranchRequestSummary = {
  requestId: Id<'branchRequests'>
  targetWorkerId: string
  sourceLocalRepoId: string
  branchName: string
  status: 'queued' | 'claimed' | 'succeeded' | 'failed'
  createdAt: number
  updatedAt: number
  claimedAt?: number
  completedAt?: number
  resultLocalRepoId?: string
  errorMessage?: string
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
): Promise<Doc<'desktopRepos'> | null> {
  return await ctx.db
    .query('desktopRepos')
    .withIndex('by_ownerTokenIdentifier_and_workerId_and_localRepoId', (q) =>
      q
        .eq('ownerTokenIdentifier', ownerTokenIdentifier)
        .eq('workerId', workerId)
        .eq('localRepoId', localRepoId)
    )
    .first()
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

function toBranchRequestSummary(request: Doc<'branchRequests'>): BranchRequestSummary {
  return {
    requestId: request._id,
    targetWorkerId: request.targetWorkerId,
    sourceLocalRepoId: request.sourceLocalRepoId,
    branchName: request.branchName,
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
    branchName: v.string()
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
      throw new Error('Source repository is not synced.')
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
