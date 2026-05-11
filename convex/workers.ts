import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

const workerStatusValidator = v.union(v.literal('online'), v.literal('busy'), v.literal('offline'))
const WORKER_NAME_MAX_LENGTH = 80

type WorkerStatus = 'online' | 'busy' | 'offline'

type CombinedDesktopWorker = {
  desktopWorkerId: Id<'desktopWorkers'>
  workerId: string
  name: string
  status: WorkerStatus
  lastSeenAt: number | null
}

function sanitizeWorkerName(name: string): string {
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error('Worker name is required.')
  }

  if (Array.from(trimmedName).length > WORKER_NAME_MAX_LENGTH) {
    throw new Error(`Worker name must be ${WORKER_NAME_MAX_LENGTH} characters or fewer.`)
  }

  return trimmedName
}

async function requireOwnerTokenIdentifier(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    throw new Error('Not authenticated')
  }

  return identity.tokenIdentifier
}

async function getDesktopWorkerDoc(
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
    lastSeenAt: heartbeat?.lastSeenAt ?? null
  }
}

export const registerDesktopWorker = mutation({
  args: {
    workerId: v.string(),
    name: v.string(),
    status: workerStatusValidator
  },
  handler: async (ctx, args): Promise<CombinedDesktopWorker> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const now = Date.now()
    const existingWorker = await getDesktopWorkerDoc(ctx, ownerTokenIdentifier, args.workerId)
    const workerName = sanitizeWorkerName(
      args.name.trim() || `Deskbinder Desktop ${args.workerId.slice(0, 8)}`
    )
    let worker: Doc<'desktopWorkers'>

    if (existingWorker) {
      await ctx.db.patch(existingWorker._id, {
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

export const updateDesktopWorkerName = mutation({
  args: {
    workerId: v.string(),
    name: v.string()
  },
  handler: async (ctx, args): Promise<CombinedDesktopWorker> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const worker = await getDesktopWorkerDoc(ctx, ownerTokenIdentifier, args.workerId)

    if (!worker || worker.hiddenAt) {
      throw new Error('Worker is not registered.')
    }

    await ctx.db.patch(worker._id, {
      name: sanitizeWorkerName(args.name),
      updatedAt: Date.now()
    })

    const updatedWorker = await ctx.db.get(worker._id)

    if (!updatedWorker) {
      throw new Error('Unable to update worker.')
    }

    return toCombinedDesktopWorker(
      updatedWorker,
      await getHeartbeat(ctx, ownerTokenIdentifier, args.workerId)
    )
  }
})

export const hideDesktopWorker = mutation({
  args: {
    workerId: v.string()
  },
  handler: async (ctx, args): Promise<{ workerId: string; hiddenAt: number }> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const worker = await getDesktopWorkerDoc(ctx, ownerTokenIdentifier, args.workerId)

    if (!worker || worker.hiddenAt) {
      throw new Error('Worker is not registered.')
    }

    const hiddenAt = Date.now()
    await ctx.db.patch(worker._id, {
      hiddenAt,
      updatedAt: hiddenAt
    })

    return { workerId: args.workerId, hiddenAt }
  }
})

export const heartbeatDesktopWorker = mutation({
  args: {
    workerId: v.string(),
    status: workerStatusValidator
  },
  handler: async (ctx, args): Promise<CombinedDesktopWorker> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const now = Date.now()
    const worker = await getDesktopWorkerDoc(ctx, ownerTokenIdentifier, args.workerId)

    if (!worker) {
      throw new Error('Worker is not registered.')
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

export const getDesktopWorker = query({
  args: {
    workerId: v.string()
  },
  handler: async (ctx, args): Promise<CombinedDesktopWorker | null> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const worker = await getDesktopWorkerDoc(ctx, ownerTokenIdentifier, args.workerId)

    if (!worker || worker.hiddenAt) {
      return null
    }

    return toCombinedDesktopWorker(
      worker,
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
      workers
        .filter((worker) => !worker.hiddenAt)
        .map(async (worker) =>
          toCombinedDesktopWorker(
            worker,
            await getHeartbeat(ctx, ownerTokenIdentifier, worker.workerId)
          )
        )
    )
  }
})
