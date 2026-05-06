import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'

type ElectronFixtures = {
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<ElectronFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, testUse, testInfo) => {
    const userDataDir = testInfo.outputPath('user-data')
    const appEntry = path.resolve(process.cwd(), 'out/main/index.js')
    const env = { ...process.env }

    delete env['ELECTRON_RUN_AS_NODE']

    await mkdir(userDataDir, { recursive: true })

    const electronApp = await electron.launch({
      args: [`--user-data-dir=${userDataDir}`, appEntry],
      cwd: process.cwd(),
      env: {
        ...env,
        DESKBINDER_USE_BUILT_RENDERER: '1',
        NODE_ENV: 'test'
      }
    })

    try {
      await testUse(electronApp)
    } finally {
      await electronApp.close().catch(() => undefined)
    }
  },

  page: async ({ electronApp }, testUse) => {
    const page = await electronApp.firstWindow()

    await page.waitForLoadState('domcontentloaded')
    await testUse(page)
  }
})

export { expect }
