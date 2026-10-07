/**
 * Single-file build: singlefile-dist/ ko ek HTML file me samet do (JS + CSS inline).
 * Output: showroom-manager-app.html (repo root) — WhatsApp/email par bhejne ya
 * kisi bhi browser me double-click karke kholne ke liye.
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'singlefile-dist')
const OUT = join(ROOT, 'showroom-manager-app.html')

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

async function listFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(full)))
    else out.push(full)
  }
  return out
}

const files = await listFiles(DIST)
let html = ''
for (const f of files) {
  if (f.endsWith('index.html')) html = await readFile(f, 'utf8')
}
if (!html) throw new Error('singlefile-dist/index.html nahi mila — pehle `npm run build:single` chalayein')

// NOTE: replacement hamesha **function** se hoti hai. Minified JS me $&, $`, $1 jaisi
// strings hoti hain, aur String.replace unhe expand kar deta hai (jisse file 6x bhaari
// ho jati thi). Function replacer us expansion ko rokta hai.
const replacer = (text) => () => text

// 1) <script type="module" src="./app.js"> → inline
for (const f of files.filter((x) => extname(x) === '.js')) {
  const code = await readFile(f, 'utf8')
  const rel = f.split('/').pop().replace('.', '\\.')
  const inline = `<script type="module">\n${code}\n</script>`
  html = html.replace(new RegExp(`<script[^>]*src="[^"]*${rel}"[^>]*></script>`, 'g'), replacer(inline))
}

// 2) <link rel="stylesheet" href="./app.css"> → inline <style>
for (const f of files.filter((x) => extname(x) === '.css')) {
  const css = await readFile(f, 'utf8')
  const rel = f.split('/').pop().replace('.', '\\.')
  html = html.replace(new RegExp(`<link[^>]*href="[^"]*${rel}"[^>]*>`, 'g'), replacer(`<style>\n${css}\n</style>`))
}

// 3) chhoti images ko base64 data URL me (offline single file ke liye)
for (const f of files.filter((x) => MIME[extname(x)])) {
  const buf = await readFile(f)
  if (buf.byteLength > 300 * 1024) continue
  const rel = f.split('/').pop()
  const dataUrl = `data:${MIME[extname(f)]};base64,${buf.toString('base64')}`
  html = html.replace(new RegExp(`(\\./)?${rel.replace('.', '\\.')}`, 'g'), replacer(dataUrl))
}

// 4) PWA/manifest/service-worker single file me bekaar hai — hata do
html = html.replace(/<link[^>]*rel="manifest"[^>]*>/g, '')
html = html.replace(/<script[^>]*registerSW[^>]*><\/script>/g, '')

await writeFile(OUT, html, 'utf8')
const size = (await stat(OUT)).size
console.log(`✅ Single file ban gayi: showroom-manager-app.html (${(size / 1024).toFixed(0)} KB)`)
console.log('   Ise kisi bhi browser me khol sakte hain (file:// bhi chalta hai).')
