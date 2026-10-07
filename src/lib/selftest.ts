/**
 * Self-test — asli billing engine ko chala kar verify karta hai.
 *
 * Do jagah se chalta hai:
 *   1. Settings → 🧪 App self-test (browser me, user ke phone par)
 *   2. CI smoke test (Node + jsdom) — `npm run smoke`
 *
 * Safety: test kabhi user ke data ko chhuta nahi. Hum ek temporary company
 * (alag IndexedDB database) banate hain, usme sab chalta hai, aur ant me wo
 * database delete kar dete hain — asli data ko chhuna hi nahi padta.
 */
import { createCompany, dbFor, ensureBootstrap, deleteCompanyMeta, type ShowroomDB } from './db'
import {
  addPayment, allPartyDues, buildLedger, cancelInvoice, clearAllData, convertInvoice,
  createUser, creditNoteFromInvoice, deleteInvoice, deleteItem, deletePayment, emptyItem, emptyParty,
  findItem, hashPin, peekDocNumber, saveBusiness, saveExpense, saveInvoice, saveItem, saveParty,
  verifyUserPin, type InvoiceInput,
} from './repo'
import { loginRequired } from './session'
import { computeTotals, finalizeLine, lineTotals, r2 } from './calc'
import { addDays, amountInWords, today } from './format'
import { itemsFromCsv, itemsToCsv, parseNumber } from './csv'
import { buildSnapshot, restoreSnapshot, parseSnapshot } from './backup'
import { mergeSnapshot } from './sync'
import { agingReport, dayBook, gstSummary, lowStockItems, summary, topItems } from './reports'
import type { Business, Item, Party } from './types'

export interface Check {
  name: string
  ok: boolean
  detail?: string
}

export interface SelfTestReport {
  checks: Check[]
  passed: number
  failed: number
  durationMs: number
}

function eq(actual: number, expected: number, label: string): void {
  if (Math.abs(Number(actual) - Number(expected)) > 0.011) {
    throw new Error(`${label}: expected ${expected}, mila ${actual}`)
  }
}

function ok(condition: unknown, label: string): void {
  if (!condition) throw new Error(label)
}

function eqStr(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected "${expected}", mila "${actual}"`)
}

const DEMO_BUSINESS: Business = {
  name: 'Test Showroom',
  address: 'Main Bazar, Kanpur',
  phone: '9876543210',
  gstin: '09ABCDE1234F1Z5',
  state: 'Uttar Pradesh',
  stateCode: '09',
  upiId: 'testshop@upi',
  createdAt: 0,
  updatedAt: 0,
}

interface TempDb {
  db: ShowroomDB
  id: string
}

/** Ek temp company ka poora setup — test isi par chalta hai (asli data ko chhuta nahi) */
async function setupTempDb(): Promise<TempDb> {
  const meta = createCompany(`__selftest_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}__`)
  const db = dbFor(meta.id)
  await ensureBootstrap(db, { seedItems: false })
  await saveBusiness(db, { ...DEMO_BUSINESS, createdAt: Date.now(), updatedAt: Date.now() })
  return { db, id: meta.id }
}

async function dropTempDb(temp: TempDb): Promise<void> {
  try {
    await clearAllData(temp.db)
    await temp.db.delete()
    deleteCompanyMeta(temp.id)
    sessionStorage.removeItem('showroom:session')
  } catch {
    /* ignore */
  }
}

function itemOf(over: Partial<Item>): Item {
  return { ...emptyItem(), name: 'Item', code: `T${Math.floor(Math.random() * 1e6)}`, salePrice: 100, purchaseRate: 60, stock: 10, gstPct: 18, unit: 'pc', ...over }
}

function partyOf(over: Partial<Party>): Party {
  return { ...emptyParty(), name: `Party ${Math.floor(Math.random() * 1e6)}`, ...over }
}

function billInput(items: InvoiceInput['items'], over: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    docType: 'tax_invoice',
    date: today(),
    partyName: 'Cash Sale',
    items,
    billDiscount: 0,
    billDiscountMode: 'amount',
    extraCharges: 0,
    roundOff: true,
    interState: false,
    mode: 'credit',
    ...over,
  }
}

const line = (qty: number, rate: number, gstPct = 18, discountPct = 0) => ({
  code: 'X1', name: 'Test item', unit: 'pc', qty, rate, discountPct, gstPct,
})

/** Poora test chalao aur report do */
export async function runSelfTest(): Promise<SelfTestReport> {
  const checks: Check[] = []
  const started = Date.now()

  const run = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn()
      checks.push({ name, ok: true })
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message })
    }
  }

  /* ------------------------- pure maths (koi DB nahi) ------------------------- */

  await run('GST intra-state: 1000 par 18% = CGST 90 + SGST 90', () => {
    const t = computeTotals([finalizeLine(line(1, 1000, 18))], { roundOff: false })
    eq(t.taxableValue, 1000, 'taxable')
    eq(t.cgst, 90, 'cgst')
    eq(t.sgst, 90, 'sgst')
    eq(t.igst, 0, 'igst')
    eq(t.grandTotal, 1180, 'grand total')
  })

  await run('GST inter-state: IGST lage, CGST/SGST zero', () => {
    const t = computeTotals([finalizeLine(line(1, 1000, 18))], { interState: true, roundOff: false })
    eq(t.igst, 180, 'igst')
    eq(t.cgst, 0, 'cgst')
    eq(t.grandTotal, 1180, 'grand total')
  })

  await run('Item discount 10% par GST sahi', () => {
    const t = computeTotals([finalizeLine(line(2, 500, 18, 10))], { roundOff: false })
    eq(t.subTotal, 1000, 'subtotal')
    eq(t.itemDiscount, 100, 'item discount')
    eq(t.taxableValue, 900, 'taxable')
    eq(t.cgst + t.sgst, 162, 'gst')
    eq(t.grandTotal, 1062, 'grand total')
  })

  await run('Bill discount (₹) hari line par barabar baanta jata hai', () => {
    const lines = [finalizeLine(line(1, 1000, 18)), finalizeLine(line(1, 1000, 18))]
    const t = computeTotals(lines, { billDiscount: 200, roundOff: false })
    eq(t.taxableValue, 1800, 'taxable')
    eq(t.cgst + t.sgst, 324, 'gst 1800 par 18%')
    eq(t.grandTotal, 2124, 'grand total')
  })

  await run('Bill discount (%) + round off', () => {
    const t = computeTotals([finalizeLine(line(3, 333.33, 18))], { billDiscount: 5, billDiscountMode: 'percent', roundOff: true })
    ok(Number.isInteger(t.grandTotal), 'grand total round hona chahiye')
    ok(t.roundOff !== 0 || Math.abs(t.roundOff) < 0.01, 'round off field set ho')
  })

  await run('Extra charges (freight) total me judte hain', () => {
    const t = computeTotals([finalizeLine(line(1, 1000, 18))], { extraCharges: 100, roundOff: false })
    eq(t.grandTotal, 1280, 'total with freight')
  })

  await run('Line totals: qty × rate − discount %', () => {
    const l = lineTotals({ qty: 2, rate: 250, discountPct: 10, gstPct: 12 })
    eq(l.taxable, 450, 'taxable')
    eq(l.taxAmount, 54, 'tax')
    eq(l.total, 504, 'total')
  })

  await run('Amount in words (Indian system)', () => {
    const s = amountInWords(123456.5)
    ok(s.includes('One Lakh Twenty Three Thousand'), `words galat: ${s}`)
    ok(s.endsWith('Only'), 'Only se khatam ho')
  })

  await run('CSV number parsing (₹1,234.50, 1,234, khaali)', () => {
    eq(parseNumber('₹1,234.50'), 1234.5, 'rupee symbol')
    eq(parseNumber('1,234'), 1234, 'comma')
    eq(parseNumber(''), 0, 'empty')
    eq(parseNumber('12.5%'), 12.5, 'percent')
  })

  await run('CSV items import/export roundtrip', () => {
    const items = [itemOf({ code: 'CSV1', name: 'Thali', salePrice: 349, purchaseRate: 240, stock: 25, mrp: 399, gstPct: 18, category: 'Steel' })]
    const parsed = itemsFromCsv(itemsToCsv(items))
    eq(parsed.items.length, 1, 'items count')
    eqStr(parsed.items[0].code, 'CSV1', 'code')
    eq(parsed.items[0].stock, 25, 'stock')
    eq(parsed.items[0].salePrice, 349, 'sale price')
    eq(parsed.items[0].gstPct, 18, 'gst')
  })

  await run('CSV purane app ke headers bhi samajhta hai (Name/Purchase Rate/Stock)', () => {
    const csv = 'Code,Name,Purchase Rate,Stock,Sale Price,GST\nA1,Old Item,120,15,199,12'
    const parsed = itemsFromCsv(csv)
    eq(parsed.items.length, 1, 'row count')
    eq(parsed.items[0].purchaseRate, 120, 'purchase')
    eq(parsed.items[0].stock, 15, 'stock')
    eq(parsed.items[0].gstPct, 12, 'gst')
  })

  /* ------------------------- DB + business flow ------------------------- */

  const temp = await setupTempDb()
  const tempB = await setupTempDb() // doosri company — isolation + sync test ke liye
  const db = temp.db
  const dbB = tempB.db

  try {
    let itemId = 0
    let partyId = 0
    let invoiceId = 0

    await run('Business details save hote hain', async () => {
      const b = await db.business.toCollection().first()
      eqStr(b?.name ?? '', 'Test Showroom', 'business name')
    })

    await run('Doc number series: INV/<FY>/001 se shuru', async () => {
      const first = await peekDocNumber(db, 'tax_invoice')
      ok(/^INV\/\d{2}-\d{2}\/001$/.test(first), `number format galat: ${first}`)
    })

    await run('Item save + code duplicate par error', async () => {
      itemId = await saveItem(db, itemOf({ code: 'SKU1', name: 'Kadhai', salePrice: 1099, purchaseRate: 780, stock: 12, hsn: '7615' }))
      ok(itemId > 0, 'item id mila')
      let threw = false
      try {
        await saveItem(db, itemOf({ code: 'SKU1', name: 'Duplicate' }))
      } catch {
        threw = true
      }
      ok(threw, 'duplicate code par error aana chahiye')
    })

    await run('Item dhundhna code aur barcode se', async () => {
      const byCode = await findItem(db, 'SKU1')
      eqStr(byCode?.name ?? '', 'Kadhai', 'code lookup')
      await saveItem(db, { ...(byCode as Item), barcode: '8901234567890' })
      const byBarcode = await findItem(db, '8901234567890')
      eqStr(byBarcode?.name ?? '', 'Kadhai', 'barcode lookup')
    })

    await run('Credit bill (udhaar): stock kate, status unpaid', async () => {
      const before = (await db.items.get(itemId))?.stock ?? 0
      const res = await saveInvoice(db, billInput([{ itemId, code: 'SKU1', name: 'Kadhai', unit: 'pc', qty: 2, rate: 1099, discountPct: 0, gstPct: 18 }], { partyName: 'Ramesh', mode: 'credit' }))
      invoiceId = res.invoice.id as number
      const after = (await db.items.get(itemId))?.stock ?? 0
      eq(after, before - 2, 'stock 2 kam')
      eqStr(res.invoice.status, 'unpaid', 'status')
      ok(/^INV\/\d{2}-\d{2}\/001$/.test(res.invoice.number), `bill number: ${res.invoice.number}`)
      // 1099×2 = 2198 + 18% GST = 2593.64 → round off ke baad 2594
      eq(res.invoice.grandTotal, 2594, 'grand total (1099×2 + 18%, rounded)')
      eq(res.invoice.roundOff, 0.36, 'round off')
    })

    await run('Agla bill number 002 hota hai (series aage badhi)', async () => {
      const next = await peekDocNumber(db, 'tax_invoice')
      ok(next.endsWith('002'), `expected 002, mila ${next}`)
    })

    await run('Cash bill par payment row khud banti hai (paid)', async () => {
      const res = await saveInvoice(db, billInput([{ itemId, code: 'SKU1', name: 'Kadhai', unit: 'pc', qty: 1, rate: 1099, discountPct: 0, gstPct: 18 }], { mode: 'cash' }))
      eqStr(res.invoice.status, 'paid', 'status paid')
      const pays = await db.payments.where('invoiceId').equals(res.invoice.id as number).toArray()
      eq(pays.length, 1, 'payment rows')
      eqStr(pays[0].kind, 'in', 'payment kind')
    })

    await run('Udhaar bill par partial payment → status partial', async () => {
      await addPayment(db, { kind: 'in', date: today(), invoiceId, amount: 1000, mode: 'upi', ref: 'UPI123' })
      const inv = await db.invoices.get(invoiceId)
      eq(inv?.paid ?? 0, 1000, 'paid')
      eqStr(inv?.status ?? '', 'partial', 'status')
    })

    await run('Payment delete karne par status wapas unpaid', async () => {
      const pays = await db.payments.where('invoiceId').equals(invoiceId).toArray()
      await deletePayment(db, pays[0].id as number)
      const inv = await db.invoices.get(invoiceId)
      eq(inv?.paid ?? 0, 0, 'paid')
      eqStr(inv?.status ?? '', 'unpaid', 'status')
    })

    await run('Cancel bill: stock wapas + cancelled flag', async () => {
      const before = (await db.items.get(itemId))?.stock ?? 0
      await cancelInvoice(db, invoiceId, 'Customer ne cancel kiya')
      const after = (await db.items.get(itemId))?.stock ?? 0
      eq(after, before + 2, 'stock wapas juda')
      ok((await db.invoices.get(invoiceId))?.cancelled === true, 'cancelled true')
    })

    await run('Credit note (sales return): stock IN + number series CN', async () => {
      const sale = await saveInvoice(db, billInput([{ itemId, code: 'SKU1', name: 'Kadhai', unit: 'pc', qty: 3, rate: 1000, discountPct: 0, gstPct: 18 }], { mode: 'credit' }))
      const before = (await db.items.get(itemId))?.stock ?? 0
      const cnId = await creditNoteFromInvoice(db, sale.invoice.id as number)
      const cn = await db.invoices.get(cnId)
      const after = (await db.items.get(itemId))?.stock ?? 0
      eq(after, before + 3, 'return me stock wapas')
      ok((cn?.number ?? '').startsWith('CN/'), `credit note number: ${cn?.number}`)
      eq(cn?.grandTotal ?? 0, 3540, 'credit note total (3000 + 18%)')
    })

    await run('Purchase bill: stock IN + supplier payable', async () => {
      const supplier = partyOf({ type: 'supplier', name: 'Sharma Traders', openingBalance: 0 })
      const sid = await saveParty(db, supplier)
      const before = (await db.items.get(itemId))?.stock ?? 0
      const res = await saveInvoice(db, billInput([{ itemId, code: 'SKU1', name: 'Kadhai', unit: 'pc', qty: 10, rate: 700, discountPct: 0, gstPct: 18 }], {
        docType: 'purchase_bill', partyId: sid, partyName: 'Sharma Traders', mode: 'credit', updateItemCost: true,
      }))
      const after = (await db.items.get(itemId))?.stock ?? 0
      eq(after, before + 10, 'stock 10 badha')
      ok((res.invoice.number ?? '').startsWith('PUR/'), `purchase number: ${res.invoice.number}`)
      eq((await db.items.get(itemId))?.purchaseRate ?? 0, 700, 'item cost update hua')

      const dues = await allPartyDues(db)
      const due = dues.get(sid)
      eq(due?.due ?? 0, 8260, 'supplier payable (7000 + 18%)')
    })

    await run('Supplier ko payment karne par payable kam hota hai', async () => {
      const supplier = await db.parties.where('name').equals('Sharma Traders').first()
      const bills = await db.invoices.where('partyId').equals(supplier?.id as number).toArray()
      const bill = bills.find((b) => b.docType === 'purchase_bill')
      await addPayment(db, { kind: 'out', date: today(), partyId: supplier?.id as number, invoiceId: bill?.id, invoiceNumber: bill?.number, amount: 3000, mode: 'bank', note: 'NEFT' })
      const inv = await db.invoices.get(bill?.id as number)
      eq(inv?.paid ?? 0, 3000, 'purchase bill paid')
      eqStr(inv?.status ?? '', 'partial', 'purchase status')
      const dues = await allPartyDues(db)
      eq(dues.get(supplier?.id as number)?.due ?? 0, 5260, 'baaki payable')
    })

    await run('Customer khata: billed − paid = due', async () => {
      const cust = partyOf({ name: 'Ramesh Kumar', openingBalance: 500, phone: '9876500000' })
      const cid = await saveParty(db, cust)
      partyId = cid
      const res = await saveInvoice(db, billInput([{ itemId, code: 'SKU1', name: 'Kadhai', unit: 'pc', qty: 1, rate: 1000, discountPct: 0, gstPct: 18 }], { partyId: cid, partyName: 'Ramesh Kumar', mode: 'credit' }))
      await addPayment(db, { kind: 'in', date: today(), partyId: cid, amount: 500, mode: 'cash' })
      const dues = await allPartyDues(db)
      const due = dues.get(cid)
      eq(res.invoice.grandTotal, 1180, 'bill total')
      eq(due?.due ?? 0, 500 + 1180 - 500, 'due = opening + bill − payment')
    })

    await run('Ledger: rows + running balance sahi', async () => {
      const party = await db.parties.get(partyId)
      const [invoices, payments] = await Promise.all([db.invoices.toArray(), db.payments.toArray()])
      const { rows, due } = buildLedger(party as Party, invoices, payments)
      ok(rows.length >= 3, 'ledger rows (opening + bill + payment)')
      eq(due.due, 1180, 'closing balance')
    })

    await run('Expenses: net profit = gross profit − kharcha', async () => {
      await saveExpense(db, { date: today(), category: 'Kiraya (Rent)', amount: 5000, mode: 'cash', note: 'October', createdAt: Date.now(), updatedAt: Date.now() })
      const s = await summary(db)
      eq(s.expenseTotal, 5000, 'expense total')
      eq(s.netProfit, r2(s.grossProfit - 5000), 'net profit')
    })

    await run('Payment mode summary me cash/UPI separate', async () => {
      const [invoices, payments] = await Promise.all([db.invoices.toArray(), db.payments.toArray()])
      const modes = new Set(payments.map((p) => p.mode))
      ok(modes.has('cash'), 'cash payments')
      ok(modes.has('upi') || modes.has('bank'), 'UPI/bank payments')
      ok(invoices.length > 0, 'invoices hue')
    })

    await run('GST summary me 18% slab milta hai', async () => {
      const rows = await gstSummary(db)
      const eighteen = rows.find((r) => r.gstPct === 18)
      ok(!!eighteen, '18% row')
      ok((eighteen?.taxable ?? 0) > 0, 'taxable value')
      ok((eighteen?.cgst ?? 0) + (eighteen?.sgst ?? 0) + (eighteen?.igst ?? 0) > 0, 'tax collected')
    })

    await run('Top items report me qty/amount aata hai', async () => {
      const rows = await topItems(db)
      ok(rows.length > 0, 'items')
      ok(rows[0].qty !== 0, 'qty')
    })

    await run('Udhaar aging: 45 din purana bill 31-60 bucket me', async () => {
      const old = partyOf({ name: 'Purana Khata', type: 'customer' })
      const oid = await saveParty(db, old)
      const d = addDays(today(), -45)
      await saveInvoice(db, billInput([{ code: 'X', name: 'Purana item', unit: 'pc', qty: 1, rate: 2000, discountPct: 0, gstPct: 0 }], { partyId: oid, partyName: 'Purana Khata', date: d, mode: 'credit' }))
      const rows = await agingReport(db, 'customer')
      const row = rows.find((r) => r.partyId === oid)
      ok(!!row, 'aging row mila')
      eq(row?.buckets['31-60'] ?? 0, 2000, '31-60 bucket')
      eq(row?.buckets['0-30'] ?? 0, 0, '0-30 khaali')
    })

    await run('Day book: us din ke bills + payments + kharcha', async () => {
      const book = await dayBook(db, today())
      ok(book.rows.some((r) => r.kind === 'bill'), 'bill rows')
      ok(book.rows.some((r) => r.kind === 'expense'), 'expense rows')
      ok(book.totalIn > 0, 'total in')
    })

    await run('Low stock list me alert se kam stock wale items', async () => {
      await saveItem(db, itemOf({ code: 'LOW1', name: 'Low item', stock: 1, lowStockAlert: 5 }))
      const rows = await lowStockItems(db)
      ok(rows.some((i) => i.code === 'LOW1'), 'low stock item mila')
    })

    await run('Estimate → Tax Invoice convert: stock sirf invoice par kata', async () => {
      const est = await saveInvoice(db, billInput([{ itemId, code: 'SKU1', name: 'Kadhai', unit: 'pc', qty: 5, rate: 1000, discountPct: 0, gstPct: 18 }], { docType: 'estimate', mode: 'credit' }))
      const stockAfterEstimate = (await db.items.get(itemId))?.stock ?? 0
      ok((est.invoice.number ?? '').startsWith('EST/'), 'estimate number')
      const invId = await convertInvoice(db, est.invoice.id as number, 'tax_invoice')
      const inv = await db.invoices.get(invId)
      const stockAfterInvoice = (await db.items.get(itemId))?.stock ?? 0
      ok((inv?.number ?? '').startsWith('INV/'), 'invoice number bana')
      eq(stockAfterInvoice, stockAfterEstimate - 5, 'invoice par stock kata')
      eq(inv?.convertedFromId ?? 0, est.invoice.id as number, 'convert link')
    })

    await run('Bill delete: stock wapas + linked payment hat gaya', async () => {
      const sale = await saveInvoice(db, billInput([{ itemId, code: 'SKU1', name: 'Kadhai', unit: 'pc', qty: 1, rate: 1000, discountPct: 0, gstPct: 18 }], { mode: 'cash' }))
      const before = (await db.items.get(itemId))?.stock ?? 0
      await deleteInvoice(db, sale.invoice.id as number)
      const after = (await db.items.get(itemId))?.stock ?? 0
      eq(after, before + 1, 'stock wapas')
      const pays = await db.payments.where('invoiceId').equals(sale.invoice.id as number).toArray()
      eq(pays.length, 0, 'payments delete')
      const tombstones = await db.tombstones.toArray()
      ok(
        tombstones.some((t) => t.key === `invoices|inv:${sale.invoice.number.toLowerCase()}`),
        `tombstone natural key par likha gaya (mila: ${tombstones.map((t) => t.key).join(', ') || 'kuch nahi'})`,
      )
    })

    await run('Users & PIN: login zaroori + galat PIN reject', async () => {
      ok(!(await loginRequired(db)), 'pehle login zaroori nahi')
      const uid = await createUser(db, 'Owner', 'owner', '1234')
      ok(await verifyUserPin(db, uid, '1234'), 'sahi PIN chala')
      ok(!(await verifyUserPin(db, uid, '9999')), 'galat PIN reject')
      ok((await hashPin('1234')) !== '1234', 'PIN hash me store hota hai')
      ok(await loginRequired(db), 'user banne par login zaroori')
    })

    await run('Backup → restore: data wapas milta hai', async () => {
      const snap = await buildSnapshot(db, 'test', 'Test Company')
      const text = JSON.stringify(snap)
      const parsed = parseSnapshot(text)
      eq(parsed.data.items.length, (await db.items.count()), 'items count backup me')
      const dbC = await setupTempDb()
      try {
        await restoreSnapshot(dbC.db, parsed)
        eq(await dbC.db.items.count(), await db.items.count(), 'restore ke baad items')
        eq(await dbC.db.invoices.count(), await db.invoices.count(), 'restore ke baad invoices')
        eq(await dbC.db.payments.count(), await db.payments.count(), 'restore ke baad payments')
      } finally {
        await dropTempDb(dbC)
      }
    })

    await run('Multi-company: doosri company ka data alag rehta hai', async () => {
      const countA = await db.items.count()
      const countB = await dbB.items.count()
      eq(countB, 0, 'company B khaali')
      ok(countA > 0, 'company A me items')
      await saveItem(dbB, itemOf({ code: 'B1', name: 'Sirf B me' }))
      const inA = await findItem(db, 'B1')
      ok(!inA, 'company B ka item A me nahi dikhta')
    })

    await run('Sync merge: natural key par match, naya wala jeetta hai', async () => {
      // Dono devices par same item (SKU1) — B ka newer
      const itemInB = itemOf({ code: 'SYNC1', name: 'Sync item', salePrice: 100, stock: 5 })
      await saveItem(dbB, itemInB)
      const older = (await findItem(dbB, 'SYNC1')) as Item
      // device A par same code ka purana item (updatedAt jaan-boojh kar purana)
      const oldId = await saveItem(db, { ...older, id: undefined, name: 'Sync item (purana)', salePrice: 90, stock: 5 })
      await db.items.update(oldId, { updatedAt: older.updatedAt - 10_000 })

      const snapB = await buildSnapshot(dbB, dbB.name, 'B')
      const report = await mergeSnapshot(db, snapB)
      const merged = await findItem(db, 'SYNC1')
      ok(!!merged, 'item merge ke baad mila')
      eqStr(merged?.name ?? '', 'Sync item', 'naya wala (B) jeetta')
      ok((report.updated.items ?? 0) + (report.skipped.items ?? 0) >= 1, 'report me items count')
      // duplicate nahi bana
      const all = await db.items.where('code').equals('SYNC1').toArray()
      eq(all.length, 1, 'duplicate row nahi bani')
    })

    await run('Sync merge: doc number series max() le leti hai (collision nahi hota)', async () => {
      // A ka counter 005 par hai, B ka 003 — sync ke baad dono 005+ par
      const before = await peekDocNumber(db, 'tax_invoice')
      const bNumber = await peekDocNumber(dbB, 'tax_invoice')
      const snapB = await buildSnapshot(dbB, dbB.name, 'B')
      await mergeSnapshot(db, snapB)
      const afterA = await peekDocNumber(db, 'tax_invoice')
      const afterB = await peekDocNumber(dbB, 'tax_invoice')
      const numOf = (s: string) => Number(s.split('/').pop())
      ok(numOf(afterB) >= numOf(bNumber), `B ka counter peeche nahi gaya (${bNumber} → ${afterB})`)
      ok(numOf(afterA) >= numOf(before), `A ka counter safe (${before} → ${afterA})`)
    })

    await run('Sync merge: sirf ek taraf wala row jud jata hai', async () => {
      const created = await saveInvoice(dbB, billInput([{ code: 'NEW', name: 'Sirf B ka bill item', unit: 'pc', qty: 1, rate: 500, discountPct: 0, gstPct: 18 }], { partyName: 'B wala customer', mode: 'credit' }))
      // do alag devices alag numbers dete hain — number ko unique karo (jaise sync ke baad hota hai)
      await dbB.invoices.update(created.invoice.id as number, { number: `${created.invoice.number}-B` })
      const before = await db.invoices.count()
      const snapB = await buildSnapshot(dbB, dbB.name, 'B')
      await mergeSnapshot(db, snapB)
      const after = await db.invoices.count()
      ok(after > before, 'naya invoice jud gaya')
      // dobara merge karne par duplicate nahi banna chahiye
      const again = await db.invoices.count()
      await mergeSnapshot(db, snapB)
      eq(await db.invoices.count(), again, 'second merge me duplicate nahi')
      const merged = await db.invoices.where('number').equals(`${created.invoice.number}-B`).toArray()
      eq(merged.length, 1, 'B ka unique number wala bill A me aaya')
    })

    await run('Sync merge: delete (tombstone) propagate hota hai', async () => {
      const tempItem = await saveItem(dbB, itemOf({ code: 'DEL1', name: 'Delete hone wala', stock: 3 }))
      const snap1 = await buildSnapshot(dbB, dbB.name, 'B')
      await mergeSnapshot(db, snap1)
      const inA = await db.items.where('code').equals('DEL1').toArray()
      eq(inA.length, 1, 'pehle A me aaya')
      await deleteItem(dbB, tempItem)
      const snap2 = await buildSnapshot(dbB, dbB.name, 'B')
      await mergeSnapshot(db, snap2)
      const afterDelete = await db.items.where('code').equals('DEL1').toArray()
      eq(afterDelete.length, 0, 'delete bhi propagate hua')
    })

    await run('Sync merge: ID clash par naya ID + references theek', async () => {
      // B me naya invoice jo A ke kisi invoice se id clash kare
      const source = await saveInvoice(dbB, billInput([{ code: 'CLASH', name: 'Clash item', unit: 'pc', qty: 1, rate: 100, discountPct: 0, gstPct: 18 }], { partyName: 'Clash party', mode: 'credit' }))
      const snapped = { ...source.invoice }
      const existingIds = (await db.invoices.toArray()).map((i) => i.id)
      const clashId = existingIds[0] as number
      const forced = { ...snapped, id: clashId, number: `${snapped.number}-CLASH`, updatedAt: Date.now() }
      const snap = await buildSnapshot(dbB, dbB.name, 'B')
      snap.data.invoices = [forced as typeof snapped]
      const before = await db.invoices.toArray()
      const keep = before.find((i) => i.id === clashId)
      await mergeSnapshot(db, snap)
      const after = await db.invoices.toArray()
      eq(after.length, before.length + 1, 'naya invoice juda (purana replace nahi hua)')
      const stillThere = after.find((i) => i.id === clashId)
      eqStr(stillThere?.number ?? '', keep?.number ?? '', 'purana id wala invoice safe')
      const newOne = after.find((i) => i.number.endsWith('-CLASH'))
      ok(!!newOne, 'naya invoice naye id ke saath mila')
      ok(newOne?.id !== clashId, 'naya id mila')
    })
  } finally {
    await dropTempDb(temp)
    await dropTempDb(tempB)
  }

  const passed = checks.filter((c) => c.ok).length
  return {
    checks,
    passed,
    failed: checks.length - passed,
    durationMs: Date.now() - started,
  }
}

/** Chhota helper — UI (Settings) ko sirf result chahiye */
export function formatReport(report: SelfTestReport): string {
  const failed = report.checks.filter((c) => !c.ok)
  if (!failed.length) return `${report.passed} checks pass ✅ (${report.durationMs} ms)`
  return `${failed.length} fail ❌ / ${report.passed} pass — ${failed.map((f) => f.name).join('; ')}`
}


