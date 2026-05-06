import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { extname, normalize, resolve } from 'node:path'

const RENDERER_ROOT = resolve(__dirname, '../renderer')
const INDEX_FILE = resolve(RENDERER_ROOT, 'index.html')

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com",
  [
    "connect-src 'self'",
    'http://localhost:*',
    'http://127.0.0.1:*',
    'ws://localhost:*',
    'ws://127.0.0.1:*',
    'https://clerk-telemetry.com',
    'https://*.clerk-telemetry.com',
    'https://*.clerk.accounts.dev',
    'https://*.clerk.com',
    'https://*.convex.cloud',
    'wss://*.convex.cloud',
    'https://*.convex.site',
    'wss://*.convex.site'
  ].join(' '),
  "img-src 'self' data: https://img.clerk.com https://*.clerk.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self' https://challenges.cloudflare.com",
  "form-action 'self'"
].join('; ')

export interface RendererServer {
  close: () => Promise<void>
  origin: string
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function endNotFound(response: ServerResponse): void {
  response.writeHead(404)
  response.end('Not found')
}

function endServerError(response: ServerResponse): void {
  response.writeHead(500)
  response.end('Internal server error')
}

async function resolveRequestPath(pathname: string): Promise<string> {
  const normalizedPath = normalize(decodeURIComponent(pathname))
  const relativePath = normalizedPath.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '')
  const requestedPath = resolve(RENDERER_ROOT, relativePath)

  if (!requestedPath.startsWith(RENDERER_ROOT)) {
    throw new Error('Path escaped renderer root')
  }

  if (!extname(requestedPath)) {
    return INDEX_FILE
  }

  await access(requestedPath)
  return requestedPath
}

async function handleRequest(urlPath: string, response: ServerResponse): Promise<void> {
  try {
    const filePath = await resolveRequestPath(urlPath)
    const fileStats = await stat(filePath)

    if (!fileStats.isFile()) {
      endNotFound(response)
      return
    }

    const contentType = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': contentType })
    createReadStream(filePath).pipe(response)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      endNotFound(response)
      return
    }

    endServerError(response)
  }
}

export async function createRendererServer(): Promise<RendererServer> {
  const server = createServer((request, response) => {
    setSecurityHeaders(response)

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    void handleRequest(requestUrl.pathname, response)
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      rejectPromise(error)
    }

    const onListening = (): void => {
      server.off('error', onError)
      resolvePromise()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Renderer server failed to bind to an address')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error)
            return
          }

          resolvePromise()
        })
      })
  }
}
