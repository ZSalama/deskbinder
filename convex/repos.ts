import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

const repoReadinessStatusValidator = v.union(
  v.literal('ready'),
  v.literal('invalid'),
  v.literal('dirty'),
  v.literal('missing_script'),
  v.literal('missing_repo'),
  v.literal('error')
)

type RepoReadinessStatus =
  | 'ready'
  | 'invalid'
  | 'dirty'
  | 'missing_script'
  | 'missing_repo'
  | 'error'

type DesktopRepoSummary = {
  desktopRepoId: Id<'desktopRepos'>
  workerId: string
  localRepoId: string
  sourceLocalRepoId?: string
  name: string
  currentBranch: string
  workspaceBranchName?: string
  isValid: boolean
  readinessStatus: RepoReadinessStatus
  readinessMessage: string | null
  lastSeenAt: number
}

async function requireOwnerTokenIdentifier(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    throw new Error('Not authenticated')
  }

  return identity.tokenIdentifier
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

function toDesktopRepoSummary(repo: Doc<'desktopRepos'>): DesktopRepoSummary {
  return {
    desktopRepoId: repo._id,
    workerId: repo.workerId,
    localRepoId: repo.localRepoId,
    sourceLocalRepoId: repo.sourceLocalRepoId,
    name: repo.name,
    currentBranch: repo.currentBranch,
    workspaceBranchName: repo.workspaceBranchName,
    isValid: repo.isValid,
    readinessStatus: repo.readinessStatus,
    readinessMessage: repo.readinessMessage ?? null,
    lastSeenAt: repo.lastSeenAt
  }
}

export const syncDesktopRepos = mutation({
  args: {
    workerId: v.string(),
    repos: v.array(
      v.object({
        localRepoId: v.string(),
        sourceLocalRepoId: v.optional(v.string()),
        name: v.string(),
        currentBranch: v.string(),
        workspaceBranchName: v.optional(v.string()),
        isValid: v.boolean(),
        readinessStatus: repoReadinessStatusValidator,
        readinessMessage: v.optional(v.string()),
        workerId: v.string(),
        lastSeenAt: v.number()
      })
    )
  },
  handler: async (ctx, args): Promise<DesktopRepoSummary[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const now = Date.now()
    const incomingRepoIds = new Set(args.repos.map((repo) => repo.localRepoId))

    for (const repo of args.repos) {
      if (repo.workerId !== args.workerId) {
        throw new Error('Repo metadata worker mismatch.')
      }

      const existingRepo = await getDesktopRepo(
        ctx,
        ownerTokenIdentifier,
        args.workerId,
        repo.localRepoId
      )
      const readinessMessage = repo.readinessMessage?.trim()
      const repoFields = {
        name: repo.name.trim() || `Repo ${repo.localRepoId.slice(0, 8)}`,
        currentBranch: repo.currentBranch,
        isValid: repo.isValid,
        readinessStatus: repo.readinessStatus,
        lastSeenAt: repo.lastSeenAt,
        updatedAt: now
      }
      const repoPatch = {
        ...repoFields,
        ...(repo.sourceLocalRepoId ? { sourceLocalRepoId: repo.sourceLocalRepoId } : {}),
        ...(repo.workspaceBranchName ? { workspaceBranchName: repo.workspaceBranchName } : {}),
        ...(readinessMessage !== undefined ? { readinessMessage } : {})
      }

      if (existingRepo) {
        await ctx.db.patch(existingRepo._id, repoPatch)
      } else {
        await ctx.db.insert('desktopRepos', {
          ownerTokenIdentifier,
          workerId: args.workerId,
          localRepoId: repo.localRepoId,
          ...repoPatch,
          createdAt: now
        })
      }
    }

    const existingRepos = await ctx.db
      .query('desktopRepos')
      .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
        q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('workerId', args.workerId)
      )
      .collect()

    await Promise.all(
      existingRepos
        .filter((repo) => !incomingRepoIds.has(repo.localRepoId))
        .map(async (repo) => {
          await ctx.db.delete(repo._id)
        })
    )

    const syncedRepos = await ctx.db
      .query('desktopRepos')
      .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
        q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('workerId', args.workerId)
      )
      .collect()

    return syncedRepos.map(toDesktopRepoSummary)
  }
})

export const listDesktopRepos = query({
  args: {
    workerId: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<DesktopRepoSummary[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const workerId = args.workerId
    const repos = workerId
      ? await ctx.db
          .query('desktopRepos')
          .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
            q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('workerId', workerId)
          )
          .collect()
      : await ctx.db
          .query('desktopRepos')
          .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
            q.eq('ownerTokenIdentifier', ownerTokenIdentifier)
          )
          .collect()

    return repos.map(toDesktopRepoSummary)
  }
})
