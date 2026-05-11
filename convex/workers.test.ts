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

describe('desktop worker management', () => {
  test('preserves user rename across desktop registration', async () => {
    const t = createTestBackend()

    await t.mutation(api.workers.registerDesktopWorker, {
      workerId: 'worker-a',
      name: 'Deskbinder Desktop worker-a',
      status: 'online'
    })

    await t.mutation(api.workers.updateDesktopWorkerName, {
      workerId: 'worker-a',
      name: 'ThinkPad'
    })

    await t.mutation(api.workers.registerDesktopWorker, {
      workerId: 'worker-a',
      name: 'Deskbinder Desktop worker-a',
      status: 'online'
    })

    await expect(t.query(api.workers.listDesktopWorkers, {})).resolves.toMatchObject([
      {
        workerId: 'worker-a',
        name: 'ThinkPad'
      }
    ])
  })

  test('hides desktop workers from user-facing lists', async () => {
    const t = createTestBackend()

    await t.mutation(api.workers.registerDesktopWorker, {
      workerId: 'worker-a',
      name: 'Worker A',
      status: 'online'
    })
    await t.mutation(api.workers.registerDesktopWorker, {
      workerId: 'worker-b',
      name: 'Worker B',
      status: 'online'
    })

    await t.mutation(api.workers.hideDesktopWorker, {
      workerId: 'worker-a'
    })

    const workers = await t.query(api.workers.listDesktopWorkers, {})
    expect(workers.map((worker) => worker.workerId)).toEqual(['worker-b'])
    await expect(
      t.query(api.workers.getDesktopWorker, { workerId: 'worker-a' })
    ).resolves.toBeNull()
  })
})
