/**
 * Chhota static server — preview-build/ ko 0.0.0.0:4173 par serve karta hai
 * (koi dependency nahi). `npm run serve:static`
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const DIR = join(ROOT, process.env.SERVE_DIR ?? 'preview-build')
const PORT = Number(process.env.PORT ?? 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
    let filePath = join(DIR, safe)
    let s = await stat(filePath).catch(() => null)
    if (!s || s.isDirectory()) {
      filePath = join(DIR, 'index.html') // SPA fallback
      s = await stat(filePath).catch(() => null)
    }
    if (!s) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    const body = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(body)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(`Server error: ${e.message}`)
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Showroom Manager static server: http://0.0.0.0:${PORT} (dir: ${DIR})`)
})
