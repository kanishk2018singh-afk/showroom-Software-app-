/**
 * Smoke test suite — CI aur local dono me chalti hai (`npm run smoke`).
 *
 * Do hisse:
 *   1. Engine checks — `runSelfTest()` (GST maths, stock, payments, khata, purchase,
 *      aging, CSV, backup, sync merge…)
 *   2. UI flow checks — asli React app ko jsdom me mount karke: onboarding →
 *      home → items → billing → save → invoice view. Ye pakadta hai wo bugs
 *      jo sirf wiring me hote hain (state, props, routing).
 */
import { createRoot, type Root } from 'react-dom/client'
import App from '../src/App'
import { runSelfTest, type SelfTestReport } from '../src/lib/selftest'

export interface UiCheck {
  name: string
  ok: boolean
  detail?: string
}

export interface SmokeResult {
  engine: SelfTestReport
  ui: UiCheck[]
}

/* ------------------------- jsdom helpers ------------------------- */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(fn: () => boolean, timeoutMs = 6000, step = 40): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (fn()) return true
    } catch {
      /* retry */
    }
    await wait(step)
  }
  return false
}

const bodyText = () => document.body?.textContent ?? ''

function allElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('*'))
}

function findByText(text: string, tag?: string): HTMLElement | undefined {
  const needle = text.toLowerCase()
  return allElements().find(
    (el) => (!tag || el.tagName.toLowerCase() === tag) && (el.textContent ?? '').toLowerCase().includes(needle) && el.children.length === 0,
  )
}

function clickByText(text: string, tag = 'button'): boolean {
  const el = findByText(text, tag) ?? (allElements().find((e) => e.tagName.toLowerCase() === tag && (e.textContent ?? '').toLowerCase().includes(text.toLowerCase())) as HTMLElement | undefined)
  if (!el) return false
  el.click()
  return true
}

function setInput(el: HTMLInputElement, value: string): void {
  const proto = el instanceof window.HTMLInputElement ? window.HTMLInputElement.prototype : Object.getPrototypeOf(el)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
  el.dispatchEvent(new window.Event('change', { bubbles: true }))
}

function inputByPlaceholder(placeholder: string): HTMLInputElement | undefined {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input')).find((i) => (i.placeholder ?? '').toLowerCase().includes(placeholder.toLowerCase()))
}

/* ------------------------- UI flow ------------------------- */

export async function runUiChecks(): Promise<UiCheck[]> {
  const checks: UiCheck[] = []
  let root: Root | null = null
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail })

  // saaf DOM (boot splash + root + print root — jaisa index.html me hai)
  document.body.innerHTML = '<div id="boot"></div><div id="root"></div><div id="print-root"></div>'
  const rootEl = document.getElementById('root')
  if (!rootEl) return [{ name: 'UI: root element', ok: false, detail: '#root nahi mila' }]

  try {
    root = createRoot(rootEl)
    root.render(<App />)

    const booted = await until(() => bodyText().includes('Apni dukaan se') || bodyText().includes('Apni dukaan set karein') || bodyText().includes('Aaj ki sale'))
    check('UI: app boot hui (onboarding ya home dikha)', booted, booted ? undefined : `Screen text: ${bodyText().slice(0, 120)}`)

    // Onboarding (agar pehli baar hai)
    if (bodyText().includes('Apni dukaan set karein')) {
      const nameInput = inputByPlaceholder('jaise: Sharma Electronics')
      if (nameInput) setInput(nameInput, 'Smoke Test Dukaan')
      await wait(120)
      const clicked = clickByText('Aage badhein')
      check('UI: onboarding form bhara aur submit hua', clicked)
      const reachedHome = await until(() => bodyText().includes('Apni dukaan set karein') === false && (bodyText().includes('Aaj ki sale') || bodyText().includes('Naya Bill')))
      check('UI: home screen khuli', reachedHome, reachedHome ? undefined : `text: ${bodyText().slice(0, 160)}`)
    } else {
      check('UI: onboarding (already done, skip)', true)
    }

    // Items screen — naya item
    const itemsNavOk = clickByText('Items')
    await wait(200)
    check('UI: Items screen khuli', itemsNavOk && bodyText().includes('Stock value'))

    clickByText('＋ Naya')
    await wait(200)
    const itemNameInput = inputByPlaceholder('jaise: Steel Kadhai 24cm')
    check('UI: item form khula', !!itemNameInput)
    if (itemNameInput) {
      setInput(itemNameInput, 'Smoke Kadhai')
      const priceInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'))
      // [0]=MRP, [1]=discount, [2]=purchase, [3]=sale, [4]=stock, [5]=low stock  (form ke order ke hisaab se)
      if (priceInputs[2]) setInput(priceInputs[2], '600')
      if (priceInputs[3]) setInput(priceInputs[3], '1000')
      if (priceInputs[4]) setInput(priceInputs[4], '10')
      await wait(120)
      const saved = clickByText('Save karein')
      await wait(400)
      check('UI: naya item save hua', saved && bodyText().includes('Smoke Kadhai'))
    }

    // Billing screen — code se item add karke bill save
    clickByText('Billing')
    await wait(250)
    const billingOpen = await until(() => bodyText().includes('Grand total'))
    check('UI: billing screen khuli', billingOpen)

    const codeInput = inputByPlaceholder('Code / barcode / naam likh kar Enter')
    check('UI: billing me code box mila', !!codeInput)
    if (codeInput) {
      // item ka apna code ya SR001 (auto-generated) — dono try karo
      setInput(codeInput, 'SR001')
      await wait(150)
      codeInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await wait(500)
      let lineAdded = bodyText().includes('Smoke Kadhai')
      if (!lineAdded) {
        // fallback: naam se dhundho aur picker se add karo
        setInput(codeInput, 'Smoke')
        await wait(150)
        codeInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await wait(600)
        lineAdded = bodyText().includes('Smoke Kadhai')
      }
      check('UI: code likh kar item bill me aaya', lineAdded, lineAdded ? undefined : `text: ${bodyText().slice(0, 200)}`)

      const saved = clickByText('Save')
      await wait(900)
      const hasNumber = /INV\/\d{2}-\d{2}\/00\d/.test(bodyText())
      check('UI: bill save hokar invoice number (INV/..) bana', saved && hasNumber, hasNumber ? undefined : `text: ${bodyText().slice(0, 240)}`)
      const invoiceView = bodyText().includes('Print') || bodyText().includes('WhatsApp')
      check('UI: invoice view ke actions dikhe', invoiceView)
    }

    // Khata screen
    clickByText('Khata')
    await wait(250)
    check('UI: Khata screen khuli', bodyText().includes('lena hai') || bodyText().includes('Kul lena hai'))

    // Baaki screens ka tour — inka render crash yahin pakda jayega
    const tour: Array<[string, string, string]> = [
      ['Payments', 'Andar aaya', 'payments screen'],
      ['Kharcha', 'Naya kharcha', 'kharcha screen'],
      ['Reports', 'Net profit', 'reports screen'],
      ['Settings', 'Dukaan ki details', 'settings screen'],
      ['More', 'Document banayein', 'more screen'],
    ]
    clickByText('More')
    await wait(250)
    for (const [buttonText, marker, label] of tour) {
      clickByText(buttonText)
      await wait(300)
      const found = bodyText().includes(marker)
      check(`UI tour: ${label} chali (${marker})`, found, found ? undefined : `text: ${bodyText().slice(0, 180)}`)
      clickByText('More')
      await wait(200)
    }

    // Bills list screen (Home → "Sab dekhein")
    clickByText('Home')
    await wait(300)
    const wentBills = clickByText('Sab dekhein')
    await wait(350)
    check('UI tour: bills list screen chali', wentBills && bodyText().includes('INV/'), bodyText().slice(0, 160))
  } catch (e) {
    check('UI: flow complete hua', false, (e as Error).message)
  } finally {
    try {
      root?.unmount()
    } catch {
      /* ignore */
    }
  }

  return checks
}

/* ------------------------- runner ------------------------- */

export async function main(): Promise<SmokeResult> {
  const engine = await runSelfTest()
  const ui = await runUiChecks()
  return { engine, ui }
}
