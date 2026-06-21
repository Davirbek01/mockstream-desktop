// ============================================================================
// runner-server — a tiny static file server for the bundled runner SPA.
// ----------------------------------------------------------------------------
// Uses ONLY node built-ins (http/fs/path). Serves the runner's Vite `dist/`
// from 127.0.0.1 on an ephemeral port. SPA fallback: any request whose path
// has no file extension (a client route) or that maps to a missing file is
// answered with index.html so BrowserRouter works. file:// would break that.
// ============================================================================

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const readFile = promisify(fs.readFile)
const stat = promisify(fs.stat)

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.webm': 'video/webm'
}

/** Resolve a Content-Type header for a request/file path by extension. */
export function contentTypeFor(p: string): string {
  const ext = path.extname(p.split('?')[0]).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/**
 * Decide whether a request path is a client-side (SPA) route that should be
 * served index.html. True when the path (sans query) has no file extension.
 */
export function isSpaFallback(reqPath: string): boolean {
  const clean = reqPath.split('?')[0]
  return path.extname(clean) === ''
}

/** Strip query/hash and decode a request URL into a relative file path. */
function requestToRelPath(url: string): string {
  const clean = url.split('?')[0].split('#')[0]
  let decoded: string
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    decoded = clean
  }
  return decoded.replace(/^\/+/, '')
}

/**
 * Start a static file server for `dir` on 127.0.0.1 with an ephemeral port.
 * Resolves to the base URL, e.g. `http://127.0.0.1:54213/`.
 */
export function startRunnerServer(dir: string): Promise<string> {
  const root = path.resolve(dir)
  const indexPath = path.join(root, 'index.html')

  const sendIndex = async (res: http.ServerResponse): Promise<void> => {
    try {
      const body = await readFile(indexPath)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(body)
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Runner index.html not found')
    }
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/'
      const rel = requestToRelPath(url)

      // Root or extensionless path → SPA route.
      if (rel === '' || isSpaFallback(url)) {
        await sendIndex(res)
        return
      }

      // Resolve within root; reject path traversal.
      const filePath = path.join(root, rel)
      if (!filePath.startsWith(root)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Forbidden')
        return
      }

      try {
        const s = await stat(filePath)
        if (!s.isFile()) {
          await sendIndex(res)
          return
        }
        const body = await readFile(filePath)
        res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) })
        res.end(body)
      } catch {
        // Missing file → SPA fallback (covers deep links to hashed assets gone).
        await sendIndex(res)
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolve(`http://127.0.0.1:${addr.port}/`)
      } else {
        reject(new Error('Failed to determine runner server address'))
      }
    })
  })
}
