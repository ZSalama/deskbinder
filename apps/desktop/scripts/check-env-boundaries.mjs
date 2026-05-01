import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const RENDERER_ROOT = resolve(ROOT, 'src/renderer')
const ENV_ROOT = resolve(ROOT, '../..')

const ALLOWED_PUBLIC_ENV_VARS = new Set([
  'VITE_CLERK_PUBLISHABLE_KEY',
  'VITE_CONVEX_URL',
  'VITE_CONVEX_SITE_URL'
])

const SUSPICIOUS_PUBLIC_ENV_PATTERN = /(SECRET|PRIVATE|PASSWORD|ACCESS_TOKEN|REFRESH_TOKEN|API_KEY)/i

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = resolve(directory, entry.name)

      if (entry.isDirectory()) {
        return walkFiles(fullPath)
      }

      return [fullPath]
    })
  )

  return files.flat()
}

async function getRendererFiles() {
  const files = await walkFiles(RENDERER_ROOT)
  return files.filter((filePath) => /\.(ts|tsx|js|jsx|html)$/.test(filePath))
}

async function checkRendererEnvUsage(errors) {
  const rendererFiles = await getRendererFiles()

  for (const filePath of rendererFiles) {
    const content = await readFile(filePath, 'utf8')

    if (content.includes('process.env')) {
      errors.push(`${filePath}: renderer code must not access process.env`)
    }

    const publicEnvMatches = content.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)

    for (const match of publicEnvMatches) {
      const envVarName = match[1]

      if (!ALLOWED_PUBLIC_ENV_VARS.has(envVarName)) {
        errors.push(`${filePath}: unexpected renderer env access ${envVarName}`)
      }
    }
  }
}

async function checkEnvFiles(errors) {
  const rootEntries = await readdir(ENV_ROOT, { withFileTypes: true })
  const envFiles = rootEntries
    .filter((entry) => entry.isFile() && /^\.env(\..+)?$/.test(entry.name))
    .map((entry) => resolve(ENV_ROOT, entry.name))

  for (const filePath of envFiles) {
    const content = await readFile(filePath, 'utf8')

    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)

      if (!match) {
        continue
      }

      const envVarName = match[1]

      if (!envVarName.startsWith('VITE_')) {
        continue
      }

      if (!ALLOWED_PUBLIC_ENV_VARS.has(envVarName)) {
        errors.push(`${filePath}: unexpected public env var ${envVarName}`)
        continue
      }

      if (SUSPICIOUS_PUBLIC_ENV_PATTERN.test(envVarName)) {
        errors.push(`${filePath}: suspicious public env var name ${envVarName}`)
      }
    }
  }
}

async function main() {
  const errors = []

  await checkRendererEnvUsage(errors)
  await checkEnvFiles(errors)

  if (errors.length > 0) {
    console.error('Environment boundary audit failed:')
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exit(1)
  }

  console.log('Environment boundary audit passed.')
}

await main()
