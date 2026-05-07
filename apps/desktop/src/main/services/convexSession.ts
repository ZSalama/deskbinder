import { ConvexHttpClient } from 'convex/browser'
import type { ConvexSessionInput } from '@deskbinder/shared/deskbinder'

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function validateConvexUrl(value: string): string {
  const parsedUrl = new URL(value)
  const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1'

  if (parsedUrl.protocol !== 'https:' && !(isLocalhost && parsedUrl.protocol === 'http:')) {
    throw new Error('Invalid Convex URL.')
  }

  return parsedUrl.toString().replace(/\/$/, '')
}

export class ConvexSession {
  private client: ConvexHttpClient | null = null

  set(input: unknown): void {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid Convex session.')
    }

    const record = input as Partial<ConvexSessionInput>
    const convexUrl = sanitizeString(record.convexUrl)
    const authToken = sanitizeString(record.authToken)

    if (!convexUrl || !authToken) {
      throw new Error('Invalid Convex session.')
    }

    this.client = new ConvexHttpClient(validateConvexUrl(convexUrl), {
      auth: authToken,
      logger: false
    })
  }

  clear(): void {
    this.client = null
  }

  requireClient(): ConvexHttpClient {
    if (!this.client) {
      throw new Error('Convex session is unavailable. Sign in again and retry.')
    }

    return this.client
  }
}
