/**
 * `npm run smoke` — poora automated test (engine + UI flow) jsdom me.
 *
 * Steps:
 *   1. smoke/entry.tsx ko esbuild se bundle karo (TypeScript + JSX)
 *   2. jsdom + fake-indexeddb ke globals set karo
 *   3. bundle chala kar report print karo (fail par exit code 1)
 *
 * node_modules na ho to ye script khud `npm install` kar leti hai (README ka promise).
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const buildDir = join(here, '.build')

function ensureDeps() {
  if (existsSync(join(root, 'node_modules', 'esbuild'))) return
  if (process.env.SMOKE_NO_INSTALL === '1') {
    console.error('❌ node_modules nahi hai aur SMOKE_NO_INSTALL=1 set hai — pehle `npm install` chalayein')
    process.exit(1)
  }
  console.log('📦 Packages nahi mile — npm install chala rahe hain…')
  const res = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } })
  if (res.status !== 0) {
    console.error('❌ npm install fail hua — internet/proxy check karein')
    process.exit(1)
  }
}

async function bundle() {
  const esbuild = await import('esbuild')
  await mkdir(buildDir, { recursive: true })
  const outfile = join(buildDir, 'bundle.mjs')
  await esbuild.build({
    entryPoints: [join(here, 'entry.tsx')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
    absWorkingDir: root,
  })
  return outfile
}

async function setupDom() {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="boot"></div><div id="root"></div><div id="print-root"></div></body></html>', {
    url: 'http://localhost:5173/',
    pretendToBeVisual: true,
    storageQuota: 100 * 1024 * 1024,
  })
  const { window } = dom

  // Node globals par jsdom window ke sab kuch copy karo (React/Dexie isi ko dekhte hain)
  const keys = [
    'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
    'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
    'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'TouchEvent',
    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'Blob', 'File', 'FileReader',
    'DOMParser', 'FormData', 'Image', 'HTMLCanvasElement', 'CSSStyleDeclaration', 'StorageEvent', 'matchMedia',
  ]
  const setGlobal = (key, value) => {
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    } catch {
      /* kuch Node globals (navigator) locked hote hain — chhod do */
    }
  }
  for (const key of keys) {
    const value = window[key]
    if (value === undefined) continue
    setGlobal(key, typeof value === 'function' && !/^(window|document|navigator|location|history|localStorage|sessionStorage)$/.test(key) ? value.bind(window) : value)
  }
  setGlobal('window', window)
  setGlobal('document', window.document)
  setGlobal('navigator', window.navigator)
  setGlobal('location', window.location)
  setGlobal('IS_REACT_ACT_ENVIRONMENT', false)

  // jsdom me nahi hoti — chhoti stubs
  window.scrollTo = () => {}
  window.matchMedia = window.matchMedia ?? ((query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.confirm = () => true
  window.open = () => null
  window.alert = () => {}
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  }
  window.HTMLCanvasElement.prototype.getContext = () => null

  // fake IndexedDB (Dexie ke liye) — globalThis par set hota hai,
  // isliye jsdom window par bhi wahi de do (Dexie kabhi-kabhi wahan dekhta hai)
  const fidb = await import('fake-indexeddb')
  setGlobal('indexedDB', fidb.indexedDB)
  setGlobal('IDBKeyRange', fidb.IDBKeyRange)
  try {
    Object.defineProperty(window, 'indexedDB', { value: fidb.indexedDB, configurable: true, writable: true })
    Object.defineProperty(window, 'IDBKeyRange', { value: fidb.IDBKeyRange, configurable: true, writable: true })
  } catch {
    /* ignore */
  }
  console.log(`   indexedDB ready (global: ${typeof globalThis.indexedDB}, window: ${typeof window.indexedDB})`)
  return dom
}

async function main() {
  ensureDeps()
  console.log('🔧 Test bundle ban raha hai…')
  const bundlePath = await bundle()
  console.log('🌐 jsdom + fake IndexedDB setup…')
  const dom = await setupDom()

  const mod = await import(`${bundlePath}?t=${Date.now()}`)
  console.log('\n⏳ Checks chal rahe hain…\n')
  const result = await mod.main()

  const engine = result.engine
  const ui = result.ui

  console.log(`🧾 Billing engine: ${engine.passed} pass, ${engine.failed} fail (${engine.durationMs} ms)`)
  for (const c of engine.checks) {
    if (!c.ok) console.log(`   ❌ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  }
  console.log(`🖥️  UI flow: ${ui.filter((c) => c.ok).length} pass, ${ui.filter((c) => !c.ok).length} fail`)
  for (const c of ui) {
    console.log(`   ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  }

  const failed = engine.failed + ui.filter((c) => !c.ok).length
  const total = engine.passed + engine.failed + ui.length
  console.log(`\n${failed === 0 ? '✅ SAB PASS' : '❌ FAIL'} — ${total - failed}/${total} checks`)

  // jsdom ke timers band karo warna process latak jayega
  dom.window.close()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('💥 Smoke test crash:', e)
  process.exit(1)
})
