/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

function createTestBackend() {
  return convexTest(schema, modules).withIdentity({
    subject: 'test-user',
    tokenIdentifier: 'test|user'
  })
}

async function registerWorker(
  t: ReturnType<typeof createTestBackend>,
  workerId: string
): Promise<void> {
  await t.mutation(api.workers.registerDesktopWorker, {
    workerId,
    name: workerId,
    status: 'online'
  })
}

async function createRepo(
  t: ReturnType<typeof createTestBackend>,
  workerId: string,
  overrides: Partial<{
    localRepoId: string
    name: string
    repoPath: string
    workspaceScriptPath: string
  }> = {}
) {
  return await t.mutation(api.repos.createDesktopRepo, {
    workerId,
    localRepoId: overrides.localRepoId ?? 'repo-1',
    name: overrides.name ?? 'Repo One',
    repoPath: overrides.repoPath ?? '/workspace/repo-one',
    workspaceScriptPath: overrides.workspaceScriptPath ?? 'new_workspace',
    agentExecutable: 'codex'
  })
}

describe('desktop repo config ownership', () => {
  test('creates a repo for a registered worker', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')

    const repo = await createRepo(t, 'worker-a')

    expect(repo).toMatchObject({
      workerId: 'worker-a',
      localRepoId: 'repo-1',
      name: 'Repo One',
      repoPath: '/workspace/repo-one',
      workspaceScriptPath: 'new_workspace',
      agentExecutable: 'codex'
    })
  })

  test('lists worker repo configs when workerId is provided', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')

    await createRepo(t, 'worker-a')
    await createRepo(t, 'worker-b', {
      localRepoId: 'repo-2',
      name: 'Repo Two',
      repoPath: '/workspace/repo-two'
    })

    const workerBReposBeforeSync = await t.query(api.repos.listDesktopRepos, {
      workerId: 'worker-b'
    })
    expect(workerBReposBeforeSync).toHaveLength(1)
    expect(workerBReposBeforeSync[0]).toMatchObject({
      workerId: 'worker-b',
      localRepoId: 'repo-2',
      readinessStatus: 'missing_repo',
      lastSeenAt: 0
    })

    await t.mutation(api.repos.syncDesktopRepoStates, {
      workerId: 'worker-b',
      repos: [
        {
          localRepoId: 'repo-2',
          currentBranch: 'worker-b-main',
          isValid: true,
          readinessStatus: 'ready',
          readinessMessage: 'Ready on worker B.',
          lastSeenAt: 123
        }
      ]
    })

    const workerBRepos = await t.query(api.repos.listDesktopRepos, {
      workerId: 'worker-b'
    })
    expect(workerBRepos[0]).toMatchObject({
      workerId: 'worker-b',
      localRepoId: 'repo-2',
      currentBranch: 'worker-b-main',
      readinessStatus: 'ready',
      lastSeenAt: 123
    })

    const workerARepos = await t.query(api.repos.listDesktopRepos, {
      workerId: 'worker-a'
    })
    expect(workerARepos[0]).toMatchObject({
      workerId: 'worker-a',
      localRepoId: 'repo-1',
      readinessStatus: 'missing_repo',
      lastSeenAt: 0
    })
  })

  test('lists account repo configs when workerId is omitted', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')

    await createRepo(t, 'worker-a')
    await createRepo(t, 'worker-b', {
      localRepoId: 'repo-2',
      name: 'Repo Two',
      repoPath: '/workspace/repo-two'
    })

    const repos = await t.query(api.repos.listDesktopRepos, {})

    expect(repos).toHaveLength(2)
    expect(repos.map((repo) => `${repo.workerId}:${repo.localRepoId}`)).toEqual([
      'worker-a:repo-1',
      'worker-b:repo-2'
    ])
  })

  test('sync only returns and updates repos owned by the syncing worker', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')

    await createRepo(t, 'worker-a')
    await createRepo(t, 'worker-b', {
      localRepoId: 'repo-2',
      name: 'Repo Two',
      repoPath: '/workspace/repo-two'
    })

    const syncedRepos = await t.mutation(api.repos.syncDesktopRepoStates, {
      workerId: 'worker-b',
      repos: [
        {
          localRepoId: 'repo-1',
          currentBranch: 'foreign-main',
          isValid: true,
          readinessStatus: 'ready',
          readinessMessage: 'Should be ignored.',
          lastSeenAt: 111
        },
        {
          localRepoId: 'repo-2',
          currentBranch: 'worker-b-main',
          isValid: true,
          readinessStatus: 'ready',
          readinessMessage: 'Ready on worker B.',
          lastSeenAt: 222
        }
      ]
    })

    expect(syncedRepos).toHaveLength(1)
    expect(syncedRepos[0]).toMatchObject({
      workerId: 'worker-b',
      localRepoId: 'repo-2',
      currentBranch: 'worker-b-main',
      lastSeenAt: 222
    })

    const workerARepos = await t.query(api.repos.listDesktopRepos, {
      workerId: 'worker-a'
    })
    expect(workerARepos[0]).toMatchObject({
      localRepoId: 'repo-1',
      readinessStatus: 'missing_repo',
      lastSeenAt: 0
    })
  })

  test('updates settings through another worker on the account-scoped config', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')
    await createRepo(t, 'worker-a')

    await t.mutation(api.repos.updateDesktopRepoSettings, {
      workerId: 'worker-b',
      localRepoId: 'repo-1',
      name: 'Renamed Repo',
      workspaceScriptPath: 'scripts/new_workspace',
      defaultScriptArgs: '--fast',
      agentExecutable: 'claude'
    })

    const workerARepos = await t.query(api.repos.listDesktopRepos, {
      workerId: 'worker-a'
    })
    expect(workerARepos[0]).toMatchObject({
      localRepoId: 'repo-1',
      name: 'Renamed Repo',
      workspaceScriptPath: 'scripts/new_workspace',
      defaultScriptArgs: '--fast',
      agentExecutable: 'claude'
    })
  })

  test('rejects duplicate active repo paths account-wide', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')
    await createRepo(t, 'worker-a')

    await expect(
      createRepo(t, 'worker-b', {
        localRepoId: 'repo-2',
        name: 'Repo Two',
        repoPath: '/workspace/repo-one'
      })
    ).rejects.toThrow('already configured')
  })

  test('rejects duplicate active repo ids account-wide', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')
    await createRepo(t, 'worker-a')

    await expect(
      createRepo(t, 'worker-b', {
        localRepoId: 'repo-1',
        name: 'Repo Duplicate',
        repoPath: '/workspace/repo-duplicate'
      })
    ).rejects.toThrow('Repository id is already configured.')
  })

  test('soft-delete hides the repo for all workers', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')
    await createRepo(t, 'worker-a')

    await t.mutation(api.repos.softDeleteDesktopRepo, {
      workerId: 'worker-b',
      localRepoId: 'repo-1'
    })

    await expect(t.query(api.repos.listDesktopRepos, { workerId: 'worker-a' })).resolves.toEqual([])
    await expect(t.query(api.repos.listDesktopRepos, { workerId: 'worker-b' })).resolves.toEqual([])
  })
})
