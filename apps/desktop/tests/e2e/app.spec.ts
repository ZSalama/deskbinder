import { test, expect } from './fixtures/electron'

test('starts the desktop shell with a restricted renderer boundary', async ({ page }) => {
  await page.waitForFunction(() => document.body.innerText.trim().length > 0)

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).toMatch(/Deskbinder|Auth setup required|Loading|Sign in/i)

  await expect.poll(() => page.evaluate(() => window.api.ping())).toBe('pong')

  await expect(page.evaluate(() => typeof window.api.getVersions)).resolves.toBe('function')
  await expect(page.evaluate(() => typeof window.api.getDevEnvironmentStatus)).resolves.toBe(
    'function'
  )
  await expect(page.evaluate(() => typeof window.api.openDevEnvironment)).resolves.toBe(
    'function'
  )
  await expect(
    page.evaluate(() => {
      const rendererGlobal = globalThis as typeof globalThis & { require?: unknown }
      return typeof rendererGlobal.require
    })
  ).resolves.toBe('undefined')
  await expect(
    page.evaluate(() => {
      const rendererGlobal = globalThis as typeof globalThis & { process?: unknown }
      return typeof rendererGlobal.process
    })
  ).resolves.toBe('undefined')
  await expect(
    page.evaluate(() => {
      const rendererGlobal = globalThis as typeof globalThis & { electron?: unknown }
      return typeof rendererGlobal.electron
    })
  ).resolves.toBe('undefined')
})
