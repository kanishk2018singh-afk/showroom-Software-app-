/**
 * Preview build: `dist/` ko `preview-build/` me copy karta hai, taaki
 * node_modules ke bina bhi (kisi bhi static server se) app chal jaye.
 */
import { cp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'preview-build')

await stat(DIST).catch(() => {
  throw new Error('dist/ nahi mila — pehle `npm run build` chalayein')
})
await rm(OUT, { recursive: true, force: true })
await cp(DIST, OUT, { recursive: true })

let bytes = 0
const files = await import('node:fs/promises').then((fs) => fs.readdir(OUT))
for (const f of files) {
  const s = await stat(join(OUT, f)).catch(() => null)
  if (s?.isFile()) bytes += s.size
}
console.log(`✅ preview-build/ ready (${files.length} files) — ab chalayein: npm run serve:static`)
