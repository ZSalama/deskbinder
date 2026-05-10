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
  test('lists account repo configs with worker-scoped readiness', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')

    await createRepo(t, 'worker-a')

    const workerBReposBeforeSync = await t.query(api.repos.listDesktopRepos, {
      workerId: 'worker-b'
    })
    expect(workerBReposBeforeSync).toHaveLength(1)
    expect(workerBReposBeforeSync[0]).toMatchObject({
      localRepoId: 'repo-1',
      readinessStatus: 'missing_repo',
      lastSeenAt: 0
    })

    await t.mutation(api.repos.syncDesktopRepoStates, {
      workerId: 'worker-b',
      repos: [
        {
          localRepoId: 'repo-1',
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
      localRepoId: 'repo-1',
      currentBranch: 'worker-b-main',
      readinessStatus: 'ready',
      lastSeenAt: 123
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

  test('imports a legacy repo by updating the existing account path', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await registerWorker(t, 'worker-b')
    await createRepo(t, 'worker-a')

    await t.mutation(api.repos.importDesktopRepoConfigs, {
      workerId: 'worker-b',
      repos: [
        {
          localRepoId: 'legacy-local-id',
          name: 'Imported Name',
          repoPath: '/workspace/repo-one',
          workspaceScriptPath: 'scripts/new_workspace',
          agentExecutable: 'claude'
        }
      ]
    })

    const repos = await t.query(api.repos.listDesktopRepos, {
      workerId: 'worker-b'
    })
    expect(repos).toHaveLength(1)
    expect(repos[0]).toMatchObject({
      localRepoId: 'repo-1',
      name: 'Imported Name',
      workspaceScriptPath: 'scripts/new_workspace',
      agentExecutable: 'claude'
    })
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
