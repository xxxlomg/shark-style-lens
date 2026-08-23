/**
 * Minimal static file server for Playwright fixtures (no dependencies).
 * Serves tests/fixtures at http://127.0.0.1:4173
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesRoot = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url))
const port = Number(process.env.PORT ?? 4173)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname.endsWith('/')) {
      pathname += 'index.html'
    }
    const filePath = normalize(join(fixturesRoot, pathname))
    if (!filePath.startsWith(normalize(fixturesRoot))) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const body = await readFile(filePath)
    res.writeHead(200, { 'content-type': types[extname(filePath)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[fixtures] http://127.0.0.1:${port} → ${fixturesRoot}`)
})
