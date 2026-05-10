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

const agentExecutableValidator = v.union(v.literal('codex'), v.literal('claude'))

const MAX_REPOS_PER_QUERY = 500
const STRING_MAX_CHARACTERS = 4_000
const SHORT_STRING_MAX_CHARACTERS = 240
const UNKNOWN_CURRENT_BRANCH = 'unknown'

type RepoReadinessStatus =
  | 'ready'
  | 'invalid'
  | 'dirty'
  | 'missing_script'
  | 'missing_repo'
  | 'error'

type AgentExecutable = 'codex' | 'claude'

type DesktopRepoConfigSummary = {
  desktopRepoId: Id<'desktopRepoConfigs'>
  workerId: string
  localRepoId: string
  sourceLocalRepoId?: string
  name: string
  repoPath: string
  workspaceScriptPath: string
  defaultScriptArgs?: string
  agentExecutable: AgentExecutable
  currentBranch: string
  workspaceBranchName?: string
  isValid: boolean
  readinessStatus: RepoReadinessStatus
  readinessMessage: string | null
  lastSeenAt: number
}

type DesktopRepoConfigInput = {
  localRepoId: string
  sourceLocalRepoId?: string
  name: string
  repoPath: string
  workspaceScriptPath: string
  defaultScriptArgs?: string
  agentExecutable: AgentExecutable
  workspaceBranchName?: string
}

async function requireOwnerTokenIdentifier(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    throw new Error('Not authenticated')
  }

  return identity.tokenIdentifier
}

async function requireDesktopWorker(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  workerId: string
): Promise<Doc<'desktopWorkers'>> {
  const worker = await ctx.db
    .query('desktopWorkers')
    .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
      q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('workerId', workerId)
    )
    .first()

  if (!worker) {
    throw new Error('Desktop worker is not registered.')
  }

  return worker
}

async function getDesktopRepoConfig(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  localRepoId: string
): Promise<Doc<'desktopRepoConfigs'> | null> {
  const repos = await ctx.db
    .query('desktopRepoConfigs')
    .withIndex('by_ownerTokenIdentifier_and_localRepoId', (q) =>
      q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('localRepoId', localRepoId)
    )
    .take(10)

  return (
    repos
      .filter((repo) => !repo.deletedAt)
      .sort((first, second) => first.createdAt - second.createdAt)[0] ?? null
  )
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

async function requireOwnedDesktopRepoConfig(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  localRepoId: string
): Promise<Doc<'desktopRepoConfigs'>> {
  const repo = await getDesktopRepoConfig(ctx, ownerTokenIdentifier, localRepoId)

  if (!repo) {
    throw new Error('Repository is unavailable.')
  }

  return repo
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

function sanitizeCurrentBranch(value: string): string {
  return sanitizeOptionalString(value, SHORT_STRING_MAX_CHARACTERS) ?? UNKNOWN_CURRENT_BRANCH
}

function toDesktopRepoSummary(
  repo: Doc<'desktopRepoConfigs'>,
  state: Doc<'desktopRepoStates'> | null
): DesktopRepoConfigSummary {
  return {
    desktopRepoId: repo._id,
    workerId: repo.workerId,
    localRepoId: repo.localRepoId,
    sourceLocalRepoId: repo.sourceLocalRepoId,
    name: repo.name,
    repoPath: repo.repoPath,
    workspaceScriptPath: repo.workspaceScriptPath,
    defaultScriptArgs: repo.defaultScriptArgs,
    agentExecutable: repo.agentExecutable,
    currentBranch: sanitizeCurrentBranch(state?.currentBranch ?? ''),
    workspaceBranchName: repo.workspaceBranchName,
    isValid: state?.isValid ?? false,
    readinessStatus: state?.readinessStatus ?? 'missing_repo',
    readinessMessage: state?.readinessMessage ?? 'Repository has not been checked on this desktop.',
    lastSeenAt: state?.lastSeenAt ?? 0
  }
}

function buildDesktopRepoConfigFields(
  ownerTokenIdentifier: string,
  workerId: string,
  repo: DesktopRepoConfigInput,
  now: number
): Omit<Doc<'desktopRepoConfigs'>, '_creationTime' | '_id'> {
  const sourceLocalRepoId = sanitizeOptionalString(
    repo.sourceLocalRepoId,
    SHORT_STRING_MAX_CHARACTERS
  )
  const defaultScriptArgs = sanitizeOptionalString(repo.defaultScriptArgs, STRING_MAX_CHARACTERS)
  const workspaceBranchName = sanitizeOptionalString(
    repo.workspaceBranchName,
    SHORT_STRING_MAX_CHARACTERS
  )

  return {
    ownerTokenIdentifier,
    workerId,
    localRepoId: sanitizeRequiredString(repo.localRepoId, 'Repo id', SHORT_STRING_MAX_CHARACTERS),
    name: sanitizeRequiredString(repo.name, 'Repo name', SHORT_STRING_MAX_CHARACTERS),
    repoPath: sanitizeRequiredString(repo.repoPath, 'Repo path', STRING_MAX_CHARACTERS),
    workspaceScriptPath: sanitizeRequiredString(
      repo.workspaceScriptPath,
      'Workspace script path',
      STRING_MAX_CHARACTERS
    ),
    agentExecutable: repo.agentExecutable,
    ...(sourceLocalRepoId ? { sourceLocalRepoId } : {}),
    ...(defaultScriptArgs ? { defaultScriptArgs } : {}),
    ...(workspaceBranchName ? { workspaceBranchName } : {}),
    createdAt: now,
    updatedAt: now
  }
}

function repoConfigNeedsPatch(
  currentRepo: Doc<'desktopRepoConfigs'>,
  nextRepo: Omit<Doc<'desktopRepoConfigs'>, '_creationTime' | '_id'>
): boolean {
  return (
    currentRepo.deletedAt !== undefined ||
    currentRepo.name !== nextRepo.name ||
    currentRepo.repoPath !== nextRepo.repoPath ||
    currentRepo.workspaceScriptPath !== nextRepo.workspaceScriptPath ||
    currentRepo.defaultScriptArgs !== nextRepo.defaultScriptArgs ||
    currentRepo.agentExecutable !== nextRepo.agentExecutable ||
    currentRepo.sourceLocalRepoId !== nextRepo.sourceLocalRepoId ||
    currentRepo.workspaceBranchName !== nextRepo.workspaceBranchName
  )
}

function buildRepoConfigPatch(
  currentRepo: Doc<'desktopRepoConfigs'>,
  nextRepo: Omit<Doc<'desktopRepoConfigs'>, '_creationTime' | '_id'>,
  options: { updateOriginWorker: boolean }
): Partial<Doc<'desktopRepoConfigs'>> {
  return {
    ...(options.updateOriginWorker ? { workerId: nextRepo.workerId } : {}),
    sourceLocalRepoId: nextRepo.sourceLocalRepoId,
    name: nextRepo.name,
    repoPath: nextRepo.repoPath,
    workspaceScriptPath: nextRepo.workspaceScriptPath,
    defaultScriptArgs: nextRepo.defaultScriptArgs,
    agentExecutable: nextRepo.agentExecutable,
    workspaceBranchName: nextRepo.workspaceBranchName,
    createdAt: currentRepo.createdAt,
    updatedAt: nextRepo.updatedAt,
    deletedAt: undefined
  }
}

async function getDesktopRepoConfigForPath(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  repoPath: string
): Promise<Doc<'desktopRepoConfigs'> | null> {
  const repos = await ctx.db
    .query('desktopRepoConfigs')
    .withIndex('by_ownerTokenIdentifier_and_repoPath', (q) =>
      q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('repoPath', repoPath)
    )
    .take(10)

  return (
    repos
      .filter((repo) => !repo.deletedAt)
      .sort((first, second) => first.createdAt - second.createdAt)[0] ?? null
  )
}

async function getAnyDesktopRepoConfigByLocalRepoId(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  localRepoId: string
): Promise<Doc<'desktopRepoConfigs'> | null> {
  const repos = await ctx.db
    .query('desktopRepoConfigs')
    .withIndex('by_ownerTokenIdentifier_and_localRepoId', (q) =>
      q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('localRepoId', localRepoId)
    )
    .take(10)

  return repos.sort((first, second) => first.createdAt - second.createdAt)[0] ?? null
}

async function listActiveRepoConfigs(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  workerId?: string
): Promise<Array<Doc<'desktopRepoConfigs'>>> {
  const repos = workerId
    ? await ctx.db
        .query('desktopRepoConfigs')
        .withIndex('by_ownerTokenIdentifier_and_workerId', (q) =>
          q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('workerId', workerId)
        )
        .take(MAX_REPOS_PER_QUERY)
    : await ctx.db
        .query('desktopRepoConfigs')
        .withIndex('by_ownerTokenIdentifier_and_localRepoId', (q) =>
          q.eq('ownerTokenIdentifier', ownerTokenIdentifier)
        )
        .take(MAX_REPOS_PER_QUERY)

  return repos
    .filter((repo) => !repo.deletedAt)
    .sort((first, second) => first.createdAt - second.createdAt)
}

async function upsertDesktopRepoConfig(
  ctx: MutationCtx,
  ownerTokenIdentifier: string,
  workerId: string,
  repoInput: DesktopRepoConfigInput
): Promise<Doc<'desktopRepoConfigs'> | null> {
  const now = Date.now()
  const repoFields = buildDesktopRepoConfigFields(ownerTokenIdentifier, workerId, repoInput, now)
  const activeRepoForPath = await getDesktopRepoConfigForPath(
    ctx,
    ownerTokenIdentifier,
    repoFields.repoPath
  )
  const pathCollision =
    activeRepoForPath && activeRepoForPath.localRepoId !== repoFields.localRepoId
      ? activeRepoForPath
      : null

  if (pathCollision) {
    throw new Error('This repository is already configured in deskbinder.')
  }

  const existingRepo = await getAnyDesktopRepoConfigByLocalRepoId(
    ctx,
    ownerTokenIdentifier,
    repoFields.localRepoId
  )

  if (existingRepo) {
    if (!existingRepo.deletedAt) {
      throw new Error('Repository id is already configured.')
    }

    if (repoConfigNeedsPatch(existingRepo, repoFields)) {
      await ctx.db.patch(
        existingRepo._id,
        buildRepoConfigPatch(existingRepo, repoFields, {
          updateOriginWorker: true
        })
      )
    }

    return await ctx.db.get(existingRepo._id)
  }

  return await ctx.db.get(await ctx.db.insert('desktopRepoConfigs', repoFields))
}

export const createDesktopRepo = mutation({
  args: {
    workerId: v.string(),
    localRepoId: v.string(),
    sourceLocalRepoId: v.optional(v.string()),
    name: v.string(),
    repoPath: v.string(),
    workspaceScriptPath: v.string(),
    defaultScriptArgs: v.optional(v.string()),
    agentExecutable: agentExecutableValidator,
    workspaceBranchName: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<DesktopRepoConfigSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    await requireDesktopWorker(ctx, ownerTokenIdentifier, args.workerId)
    const repo = await upsertDesktopRepoConfig(ctx, ownerTokenIdentifier, args.workerId, args)

    if (!repo) {
      throw new Error('Unable to create repository.')
    }

    return toDesktopRepoSummary(
      repo,
      await getDesktopRepoState(ctx, ownerTokenIdentifier, args.workerId, repo.localRepoId)
    )
  }
})

export const updateDesktopRepoSettings = mutation({
  args: {
    workerId: v.string(),
    localRepoId: v.string(),
    name: v.string(),
    workspaceScriptPath: v.string(),
    defaultScriptArgs: v.optional(v.string()),
    agentExecutable: agentExecutableValidator
  },
  handler: async (ctx, args): Promise<DesktopRepoConfigSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const repo = await requireOwnedDesktopRepoConfig(ctx, ownerTokenIdentifier, args.localRepoId)
    const defaultScriptArgs = sanitizeOptionalString(args.defaultScriptArgs, STRING_MAX_CHARACTERS)

    await ctx.db.patch(repo._id, {
      name: sanitizeRequiredString(args.name, 'Repo name', SHORT_STRING_MAX_CHARACTERS),
      workspaceScriptPath: sanitizeRequiredString(
        args.workspaceScriptPath,
        'Workspace script path',
        STRING_MAX_CHARACTERS
      ),
      defaultScriptArgs,
      agentExecutable: args.agentExecutable,
      updatedAt: Date.now()
    })

    const updatedRepo = await ctx.db.get(repo._id)

    if (!updatedRepo) {
      throw new Error('Repository is unavailable.')
    }

    return toDesktopRepoSummary(
      updatedRepo,
      await getDesktopRepoState(ctx, ownerTokenIdentifier, args.workerId, args.localRepoId)
    )
  }
})

export const softDeleteDesktopRepo = mutation({
  args: {
    workerId: v.string(),
    localRepoId: v.string()
  },
  handler: async (ctx, args): Promise<DesktopRepoConfigSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const repo = await requireOwnedDesktopRepoConfig(ctx, ownerTokenIdentifier, args.localRepoId)
    const now = Date.now()

    await ctx.db.patch(repo._id, {
      deletedAt: now,
      updatedAt: now
    })

    return toDesktopRepoSummary(
      { ...repo, deletedAt: now, updatedAt: now },
      await getDesktopRepoState(ctx, ownerTokenIdentifier, args.workerId, args.localRepoId)
    )
  }
})

export const getDesktopRepoConfigForExecution = query({
  args: {
    workerId: v.string(),
    localRepoId: v.string()
  },
  handler: async (ctx, args): Promise<DesktopRepoConfigSummary> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const repo = await requireOwnedDesktopRepoConfig(ctx, ownerTokenIdentifier, args.localRepoId)

    return toDesktopRepoSummary(
      repo,
      await getDesktopRepoState(ctx, ownerTokenIdentifier, args.workerId, args.localRepoId)
    )
  }
})

export const listDesktopRepos = query({
  args: {
    workerId: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<DesktopRepoConfigSummary[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    const activeRepos = await listActiveRepoConfigs(ctx, ownerTokenIdentifier, args.workerId)

    return await Promise.all(
      activeRepos.map(async (repo) =>
        toDesktopRepoSummary(
          repo,
          await getDesktopRepoState(
            ctx,
            ownerTokenIdentifier,
            args.workerId ?? repo.workerId,
            repo.localRepoId
          )
        )
      )
    )
  }
})

export const syncDesktopRepoStates = mutation({
  args: {
    workerId: v.string(),
    repos: v.array(
      v.object({
        localRepoId: v.string(),
        currentBranch: v.string(),
        isValid: v.boolean(),
        readinessStatus: repoReadinessStatusValidator,
        readinessMessage: v.optional(v.string()),
        lastSeenAt: v.number()
      })
    )
  },
  handler: async (ctx, args): Promise<DesktopRepoConfigSummary[]> => {
    const ownerTokenIdentifier = await requireOwnerTokenIdentifier(ctx)
    await requireDesktopWorker(ctx, ownerTokenIdentifier, args.workerId)
    const now = Date.now()

    for (const repoState of args.repos) {
      const repo = await requireOwnedDesktopRepoConfig(
        ctx,
        ownerTokenIdentifier,
        repoState.localRepoId
      )

      if (repo.workerId !== args.workerId) {
        continue
      }

      const existingState = await getDesktopRepoState(
        ctx,
        ownerTokenIdentifier,
        args.workerId,
        repo.localRepoId
      )
      const readinessMessage = sanitizeOptionalString(
        repoState.readinessMessage,
        STRING_MAX_CHARACTERS
      )
      const stateFields = {
        ownerTokenIdentifier,
        workerId: args.workerId,
        localRepoId: repo.localRepoId,
        currentBranch: sanitizeCurrentBranch(repoState.currentBranch),
        isValid: repoState.isValid,
        readinessStatus: repoState.readinessStatus,
        ...(readinessMessage ? { readinessMessage } : {}),
        lastSeenAt: repoState.lastSeenAt,
        updatedAt: now
      }

      if (existingState) {
        await ctx.db.patch(existingState._id, stateFields)
      } else {
        await ctx.db.insert('desktopRepoStates', stateFields)
      }
    }

    const activeRepos = await listActiveRepoConfigs(ctx, ownerTokenIdentifier, args.workerId)

    return await Promise.all(
      activeRepos.map(async (repo) =>
        toDesktopRepoSummary(
          repo,
          await getDesktopRepoState(ctx, ownerTokenIdentifier, args.workerId, repo.localRepoId)
        )
      )
    )
  }
})
