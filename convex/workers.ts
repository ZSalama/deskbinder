import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

const workerStatusValidator = v.union(v.literal('online'), v.literal('busy'), v.literal('offline'))

type WorkerStatus = 'online' | 'busy' | 'offline'

type CombinedDesktopWorker = {
  desktopWorkerId: Id<'desktopWorkers'>
  workerId: string
  name: string
  status: WorkerStatus
  autoRunEnabled: boolean
  lastSeenAt: number | null
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

async function getHeartbeat(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  workerId: string
): Promise<Doc<'desktopWorkerHeartbeats'> | null> {
  return await ctx.db
    .query('desktopWorkerHeartbeats')
    .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
      q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('workerId', workerId)
    )
    .first()
}

function toCombinedDesktopWorker(
  worker: Doc<'desktopWorkers'>,
  heartbeat: Doc<'desktopWorkerHeartbeats'> | null
): CombinedDesktopWorker {
  return {
    desktopWorkerId: worker._id,
    workerId: worker.workerId,
    name: worker.name,
    status: heartbeat?.status ?? 'offline',
    autoRunEnabled: worker.autoRunEnabled,
    lastSeenAt: heartbeat?.lastSeenAt ?? null
  }
}

export const registerDesktopWorker = mutation({
  args: {
    workerId: v.string(),
    name: v.string(),
    autoRunEnabled: v.boolean(),
    status: workerStatusValidator
  },
  handler: async (ctx, args): Promise<CombinedDesktopWorker> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const now = Date.now()
    const existingWorker = await getDesktopWorker(ctx, ownerTokenIdentifier, args.workerId)
    const workerName = args.name.trim() || `Deskbinder Desktop ${args.workerId.slice(0, 8)}`
    let worker: Doc<'desktopWorkers'>

    if (existingWorker) {
      await ctx.db.patch(existingWorker._id, {
        name: workerName,
        autoRunEnabled: args.autoRunEnabled,
        updatedAt: now
      })
      const updatedWorker = await ctx.db.get(existingWorker._id)

      if (!updatedWorker) {
        throw new Error('Unable to register worker.')
      }

      worker = updatedWorker
    } else {
      const desktopWorkerId = await ctx.db.insert('desktopWorkers', {
        ownerTokenIdentifier,
        workerId: args.workerId,
        name: workerName,
        autoRunEnabled: args.autoRunEnabled,
        createdAt: now,
        updatedAt: now
      })
      const insertedWorker = await ctx.db.get(desktopWorkerId)

      if (!insertedWorker) {
        throw new Error('Unable to register worker.')
      }

      worker = insertedWorker
    }

    const existingHeartbeat = await getHeartbeat(ctx, ownerTokenIdentifier, args.workerId)

    if (existingHeartbeat) {
      await ctx.db.patch(existingHeartbeat._id, {
        desktopWorkerId: worker._id,
        status: args.status,
        lastSeenAt: now,
        updatedAt: now
      })
    } else {
      await ctx.db.insert('desktopWorkerHeartbeats', {
        ownerTokenIdentifier,
        desktopWorkerId: worker._id,
        workerId: args.workerId,
        status: args.status,
        lastSeenAt: now,
        updatedAt: now
      })
    }

    return toCombinedDesktopWorker(
      worker,
      await getHeartbeat(ctx, ownerTokenIdentifier, args.workerId)
    )
  }
})

export const heartbeatDesktopWorker = mutation({
  args: {
    workerId: v.string(),
    autoRunEnabled: v.boolean(),
    status: workerStatusValidator
  },
  handler: async (ctx, args): Promise<CombinedDesktopWorker> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const now = Date.now()
    const worker = await getDesktopWorker(ctx, ownerTokenIdentifier, args.workerId)

    if (!worker) {
      throw new Error('Worker is not registered.')
    }

    if (worker.autoRunEnabled !== args.autoRunEnabled) {
      await ctx.db.patch(worker._id, {
        autoRunEnabled: args.autoRunEnabled,
        updatedAt: now
      })
    }

    const existingHeartbeat = await getHeartbeat(ctx, ownerTokenIdentifier, args.workerId)

    if (existingHeartbeat) {
      await ctx.db.patch(existingHeartbeat._id, {
        desktopWorkerId: worker._id,
        status: args.status,
        lastSeenAt: now,
        updatedAt: now
      })
    } else {
      await ctx.db.insert('desktopWorkerHeartbeats', {
        ownerTokenIdentifier,
        desktopWorkerId: worker._id,
        workerId: args.workerId,
        status: args.status,
        lastSeenAt: now,
        updatedAt: now
      })
    }

    const updatedWorker = (await ctx.db.get(worker._id)) ?? worker

    return toCombinedDesktopWorker(
      updatedWorker,
      await getHeartbeat(ctx, ownerTokenIdentifier, args.workerId)
    )
  }
})

export const listDesktopWorkers = query({
  args: {},
  handler: async (ctx): Promise<CombinedDesktopWorker[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const workers = await ctx.db
      .query('desktopWorkers')
      .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
        q.eq('ownerTokenIdentifier', ownerTokenIdentifier)
      )
      .collect()

    return await Promise.all(
      workers.map(async (worker) =>
        toCombinedDesktopWorker(
          worker,
          await getHeartbeat(ctx, ownerTokenIdentifier, worker.workerId)
        )
      )
    )
  }
})
