/**
 * Reports — sab aggregations ek jagah.
 *
 * Design rule: sirf `invoices`, `payments`, `expenses` padho aur ek hi baar
 * memory me load karke aggregate karo. Dukaan-level data (hazaaron rows) ke liye
 * ye kaafi fast hai aur code simple rehta hai. Har report cancelled bills
 * apne aap chhod deti hai.
 */
import type { ShowroomDB } from './db'
import { isAccountedDoc, isSaleDoc, r2 } from './calc'
import { addDays, daysBetween, monthLabel, today } from './format'
import { computeDue } from './repo'
import type { DateRange, Expense, Invoice, Item, Party, Payment, PayMode } from './types'

export interface Summary {
  netSale: number
  taxableValue: number
  gstCollected: number
  discount: number
  purchaseTotal: number
  expenseTotal: number
  grossProfit: number
  netProfit: number
  billCount: number
  totalQty: number
  avgBill: number
}

const inRange = (date: string, range?: DateRange) => (!range ? true : date >= range.from && date <= range.to)

/** Ek jagah sab data load — baaki reports isi ka use karti hain */
async function loadDocs(db: ShowroomDB) {
  const [invoices, payments, expenses, items, parties] = await Promise.all([
    db.invoices.toArray(),
    db.payments.toArray(),
    db.expenses.toArray(),
    db.items.toArray(),
    db.parties.toArray(),
  ])
  return { invoices, payments, expenses, items, parties }
}

function profitOfSale(inv: Invoice): number {
  // Taxable value (discount ke baad) − maal ki cost
  let cost = 0
  for (const l of inv.lines) {
    if (l.cost === undefined) continue
    const lineTaxable = l.taxable - (inv.subTotal > 0 ? (inv.billDiscount * l.taxable) / Math.max(1, inv.subTotal - inv.itemDiscount) : 0)
    const unitTaxable = l.qty > 0 ? lineTaxable / l.qty : 0
    const unitProfit = unitTaxable - (l.cost || 0)
    cost += unitProfit * l.qty
  }
  return r2(cost)
}

export async function summary(db: ShowroomDB, range?: DateRange): Promise<Summary> {
  const { invoices, expenses } = await loadDocs(db)
  const live = invoices.filter((i) => !i.cancelled && inRange(i.date, range))

  const gross = live.filter((i) => i.docType === 'tax_invoice' || i.docType === 'bill_of_supply')
  const returns = live.filter((i) => i.docType === 'credit_note')
  const purchases = live.filter((i) => i.docType === 'purchase_bill')

  const sum = (arr: Invoice[], f: (i: Invoice) => number) => r2(arr.reduce((s, i) => s + f(i), 0))

  const netSale = r2(sum(gross, (i) => i.grandTotal) - sum(returns, (i) => i.grandTotal))
  const taxableValue = r2(sum(gross, (i) => i.taxableValue) - sum(returns, (i) => i.taxableValue))
  const gstCollected = r2(sum(gross, (i) => i.cgst + i.sgst + i.igst) - sum(returns, (i) => i.cgst + i.sgst + i.igst))
  const discount = r2(sum(gross, (i) => i.itemDiscount + i.billDiscount) - sum(returns, (i) => i.itemDiscount + i.billDiscount))
  const purchaseTotal = sum(purchases, (i) => i.grandTotal)
  const grossProfit = r2(sum(gross, (i) => profitOfSale(i)) - sum(returns, (i) => profitOfSale(i)))
  const expenseTotal = r2(sum2(expenses.filter((e) => inRange(e.date, range)), (e) => e.amount))

  const billCount = gross.length
  const totalQty = r2(sum(gross, (i) => i.totalQty) - sum(returns, (i) => i.totalQty))

  return {
    netSale,
    taxableValue,
    gstCollected,
    discount,
    purchaseTotal,
    expenseTotal,
    grossProfit,
    netProfit: r2(grossProfit - expenseTotal),
    billCount,
    totalQty,
    avgBill: billCount ? r2(netSale / billCount) : 0,
  }
}

function sum2<T>(arr: T[], f: (x: T) => number): number {
  return arr.reduce((s, x) => s + f(x), 0)
}

export interface DayPoint {
  date: string
  sale: number
  purchase: number
}

/** Din-wise sale/purchase — bar/line chart ke liye */
export async function dailySeries(db: ShowroomDB, range: DateRange): Promise<DayPoint[]> {
  const { invoices } = await loadDocs(db)
  const map = new Map<string, DayPoint>()
  let cursor = range.from
  let guard = 0
  while (cursor <= range.to && guard < 800) {
    map.set(cursor, { date: cursor, sale: 0, purchase: 0 })
    cursor = addDays(cursor, 1)
    guard += 1
  }
  for (const inv of invoices) {
    if (inv.cancelled || !inRange(inv.date, range)) continue
    const point = map.get(inv.date)
    if (!point) continue
    if (isSaleDoc(inv.docType)) point.sale = r2(point.sale + (inv.docType === 'credit_note' ? -inv.grandTotal : inv.grandTotal))
    if (inv.docType === 'purchase_bill') point.purchase = r2(point.purchase + inv.grandTotal)
  }
  return [...map.values()]
}

export interface MonthPoint {
  month: string
  label: string
  sale: number
  purchase: number
}

export async function monthlySeries(db: ShowroomDB, range?: DateRange): Promise<MonthPoint[]> {
  const { invoices } = await loadDocs(db)
  const map = new Map<string, MonthPoint>()
  for (const inv of invoices) {
    if (inv.cancelled || !inRange(inv.date, range)) continue
    const key = inv.date.slice(0, 7)
    const point = map.get(key) ?? { month: key, label: monthLabel(`${key}-01`), sale: 0, purchase: 0 }
    if (isSaleDoc(inv.docType)) point.sale = r2(point.sale + (inv.docType === 'credit_note' ? -inv.grandTotal : inv.grandTotal))
    if (inv.docType === 'purchase_bill') point.purchase = r2(point.purchase + inv.grandTotal)
    map.set(key, point)
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12)
}

export interface ItemRow {
  key: string
  name: string
  code?: string
  qty: number
  amount: number
  profit: number
}

export async function topItems(db: ShowroomDB, range?: DateRange, limit = 10): Promise<ItemRow[]> {
  const { invoices } = await loadDocs(db)
  const map = new Map<string, ItemRow>()
  for (const inv of invoices) {
    if (inv.cancelled || !inRange(inv.date, range) || !isSaleDoc(inv.docType)) continue
    const sign = inv.docType === 'credit_note' ? -1 : 1
    for (const l of inv.lines) {
      const key = l.itemId ? `id:${l.itemId}` : `nm:${l.name.toLowerCase()}`
      const row = map.get(key) ?? { key, name: l.name, code: l.code, qty: 0, amount: 0, profit: 0 }
      const share = inv.subTotal - inv.itemDiscount
      const billShare = share > 0 ? (inv.billDiscount * l.taxable) / share : 0
      const lineProfit = r2((l.taxable - billShare) - (l.cost ?? 0) * l.qty)
      row.qty = r2(row.qty + sign * l.qty)
      row.amount = r2(row.amount + sign * l.total)
      row.profit = r2(row.profit + sign * lineProfit)
      map.set(key, row)
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, limit)
}

export interface PartyRow {
  partyId?: number
  name: string
  amount: number
  bills: number
}

export async function topParties(db: ShowroomDB, range?: DateRange, limit = 10): Promise<PartyRow[]> {
  const { invoices } = await loadDocs(db)
  const map = new Map<string, PartyRow>()
  for (const inv of invoices) {
    if (inv.cancelled || !inRange(inv.date, range) || !isSaleDoc(inv.docType)) continue
    const key = inv.partyId ? `id:${inv.partyId}` : `nm:${inv.partyName.toLowerCase()}`
    const row = map.get(key) ?? { partyId: inv.partyId, name: inv.partyName || 'Cash sale', amount: 0, bills: 0 }
    row.amount = r2(row.amount + (inv.docType === 'credit_note' ? -inv.grandTotal : inv.grandTotal))
    row.bills += 1
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, limit)
}

export interface ModeRow {
  mode: string
  totalIn: number
  totalOut: number
}

export async function paymentModeSummary(db: ShowroomDB, range?: DateRange): Promise<ModeRow[]> {
  const { payments } = await loadDocs(db)
  const map = new Map<string, ModeRow>()
  for (const p of payments) {
    if (!inRange(p.date, range)) continue
    const row = map.get(p.mode) ?? { mode: p.mode, totalIn: 0, totalOut: 0 }
    if (p.kind === 'in') row.totalIn = r2(row.totalIn + p.amount)
    else row.totalOut = r2(row.totalOut + p.amount)
    map.set(p.mode, row)
  }
  return [...map.values()].sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut))
}

export interface GstRow {
  gstPct: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  tax: number
}

export async function gstSummary(db: ShowroomDB, range?: DateRange): Promise<GstRow[]> {
  const { invoices } = await loadDocs(db)
  const map = new Map<number, GstRow>()
  for (const inv of invoices) {
    if (inv.cancelled || !inRange(inv.date, range)) continue
    if (inv.docType !== 'tax_invoice' && inv.docType !== 'credit_note') continue
    const sign = inv.docType === 'credit_note' ? -1 : 1
    const inter = inv.igst > 0
    for (const l of inv.lines) {
      const rate = l.gstPct || 0
      const row = map.get(rate) ?? { gstPct: rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 }
      const share = inv.subTotal - inv.itemDiscount
      const billShare = share > 0 ? (inv.billDiscount * l.taxable) / share : 0
      const taxable = r2((l.taxable - billShare) * sign)
      const tax = r2((taxable * rate) / 100)
      row.taxable = r2(row.taxable + taxable)
      if (inter) row.igst = r2(row.igst + tax)
      else {
        const half = Math.floor((tax * 100) / 2) / 100
        row.cgst = r2(row.cgst + half)
        row.sgst = r2(row.sgst + (tax - half))
      }
      row.tax = r2(row.tax + tax)
      map.set(rate, row)
    }
  }
  return [...map.values()].sort((a, b) => a.gstPct - b.gstPct)
}

export interface HsnRow {
  hsn: string
  qty: number
  taxable: number
  tax: number
  total: number
}

export async function hsnSummary(db: ShowroomDB, range?: DateRange): Promise<HsnRow[]> {
  const { invoices } = await loadDocs(db)
  const map = new Map<string, HsnRow>()
  for (const inv of invoices) {
    if (inv.cancelled || !inRange(inv.date, range)) continue
    if (inv.docType !== 'tax_invoice' && inv.docType !== 'credit_note') continue
    const sign = inv.docType === 'credit_note' ? -1 : 1
    for (const l of inv.lines) {
      const hsn = l.hsn || '-'
      const row = map.get(hsn) ?? { hsn, qty: 0, taxable: 0, tax: 0, total: 0 }
      row.qty = r2(row.qty + sign * l.qty)
      row.taxable = r2(row.taxable + sign * l.taxable)
      row.tax = r2(row.tax + sign * l.taxAmount)
      row.total = r2(row.taxable + row.tax)
      map.set(hsn, row)
    }
  }
  return [...map.values()].sort((a, b) => b.taxable - a.taxable)
}

export interface StockRow {
  category: string
  items: number
  qty: number
  costValue: number
  saleValue: number
}

export async function stockValue(db: ShowroomDB): Promise<{ rows: StockRow[]; totalCost: number; totalSale: number; totalQty: number }> {
  const items = await db.items.toArray()
  const map = new Map<string, StockRow>()
  for (const it of items) {
    const key = it.category || 'Bina category'
    const row = map.get(key) ?? { category: key, items: 0, qty: 0, costValue: 0, saleValue: 0 }
    row.items += 1
    row.qty = r2(row.qty + it.stock)
    row.costValue = r2(row.costValue + it.stock * it.purchaseRate)
    row.saleValue = r2(row.saleValue + it.stock * it.salePrice)
    map.set(key, row)
  }
  const rows = [...map.values()].sort((a, b) => b.costValue - a.costValue)
  return {
    rows,
    totalCost: r2(sum2(rows, (r) => r.costValue)),
    totalSale: r2(sum2(rows, (r) => r.saleValue)),
    totalQty: r2(sum2(rows, (r) => r.qty)),
  }
}

export async function lowStockItems(db: ShowroomDB): Promise<Item[]> {
  const items = await db.items.toArray()
  return items.filter((i) => i.stock <= (i.lowStockAlert ?? 0)).sort((a, b) => a.stock - b.stock)
}

/* ---------------- Udhaar aging ---------------- */

export interface AgingRow {
  partyId?: number
  partyName: string
  phone?: string
  buckets: Record<'0-30' | '31-60' | '61-90' | '90+', number>
  total: number
  oldestDays: number
}

/**
 * Aging: purane bill se naya payment adjust (FIFO).
 * On-account payments + opening balance bhi sahi tarike se adjust hote hain.
 */
export async function agingReport(db: ShowroomDB, side: 'customer' | 'supplier', asOf = today()): Promise<AgingRow[]> {
  const { invoices, payments, parties } = await loadDocs(db)
  const rows: AgingRow[] = []

  for (const party of parties) {
    if (party.type !== side && party.type !== 'both') continue
    const docs = invoices
      .filter((i) => i.partyId === party.id && !i.cancelled && isAccountedDoc(i.docType))
      .filter((i) => (side === 'supplier' ? i.docType === 'purchase_bill' : i.docType !== 'purchase_bill'))
      .sort((a, b) => a.date.localeCompare(b.date))
    const pays = payments.filter((p) => p.partyId === party.id).sort((a, b) => a.date.localeCompare(b.date))

    // open items: bills (+) aur credit notes (−) date-wise; opening balance sabse purana
    const open: Array<{ date: string; due: number }> = []
    if (party.openingBalance > 0) open.push({ date: `${party.createdAt ? new Date(party.createdAt).toISOString().slice(0, 10) : '2000-01-01'}`, due: party.openingBalance })
    for (const d of docs) {
      const amount = d.docType === 'credit_note' ? -d.grandTotal : r2(d.grandTotal - d.paid)
      if (Math.abs(amount) > 0.009) open.push({ date: d.date, due: amount })
    }

    // Bill-wise payments invoice.paid me pehle se chala gaya hai.
    // On-account / advance payments ka pool bacha — usse purane bill par FIFO adjust karo.
    let pool = pays.filter((p) => p.onAccount).reduce((s, p) => s + p.amount, 0)
    const due = computeDue(party, invoices, payments).due

    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    let total = 0
    let oldestDays = 0
    for (const item of open.sort((a, b) => a.date.localeCompare(b.date))) {
      let remaining = item.due
      if (remaining > 0 && pool > 0) {
        const used = Math.min(pool, remaining)
        pool -= used
        remaining -= used
      }
      if (Math.abs(remaining) < 0.009) continue
      const days = daysBetween(item.date, asOf)
      const clampedDays = Math.max(0, days)
      const key = clampedDays <= 30 ? '0-30' : clampedDays <= 60 ? '31-60' : clampedDays <= 90 ? '61-90' : '90+'
      buckets[key] = r2(buckets[key] + remaining)
      total = r2(total + remaining)
      oldestDays = Math.max(oldestDays, clampedDays)
    }

    if (Math.abs(total) > 0.009 && Math.abs(due) > 0.009) {
      rows.push({ partyId: party.id, partyName: party.name, phone: party.phone, buckets, total, oldestDays })
    } else if (Math.abs(due) > 0.009) {
      // Opening balance ya kuch bacha hua — due hi dikhado (worst-case bucket)
      const days = party.createdAt ? Math.max(0, daysBetween(new Date(party.createdAt).toISOString().slice(0, 10), asOf)) : 0
      const key = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'
      buckets[key] = r2(buckets[key] + due)
      rows.push({ partyId: party.id, partyName: party.name, phone: party.phone, buckets, total: due, oldestDays: days })
    }
  }

  return rows.sort((a, b) => b.total - a.total)
}

/* ---------------- Day book ---------------- */

export interface DayBookRow {
  kind: 'bill' | 'payment' | 'expense'
  ref: string
  label: string
  party: string
  inAmount: number
  outAmount: number
  detail: string
}

export async function dayBook(db: ShowroomDB, date: string): Promise<{ rows: DayBookRow[]; totalIn: number; totalOut: number }> {
  const { invoices, payments, expenses } = await loadDocs(db)
  const rows: DayBookRow[] = []

  for (const inv of invoices.filter((i) => i.date === date && !i.cancelled)) {
    const isPurchase = inv.docType === 'purchase_bill'
    rows.push({
      kind: 'bill',
      ref: inv.number,
      label: inv.docType,
      party: inv.partyName || 'Cash',
      inAmount: isPurchase ? 0 : inv.grandTotal,
      outAmount: isPurchase ? inv.grandTotal : 0,
      detail: `${inv.lines.length} item · ${inv.status}`,
    })
  }
  for (const p of payments.filter((p) => p.date === date)) {
    rows.push({
      kind: 'payment',
      ref: p.invoiceNumber || 'On account',
      label: `Payment ${p.kind === 'in' ? 'In' : 'Out'}`,
      party: p.partyName || '—',
      inAmount: p.kind === 'in' ? p.amount : 0,
      outAmount: p.kind === 'out' ? p.amount : 0,
      detail: `${p.mode}${p.ref ? ` · ${p.ref}` : ''}`,
    })
  }
  for (const e of expenses.filter((e) => e.date === date)) {
    rows.push({
      kind: 'expense',
      ref: e.category,
      label: 'Kharcha',
      party: '—',
      inAmount: 0,
      outAmount: e.amount,
      detail: `${e.mode}${e.note ? ` · ${e.note}` : ''}`,
    })
  }

  return {
    rows,
    totalIn: r2(sum2(rows, (r) => r.inAmount)),
    totalOut: r2(sum2(rows, (r) => r.outAmount)),
  }
}

/* ---------------- Plain tables (CSV export ke liye) ---------------- */

export interface Table {
  name: string
  headers: string[]
  rows: Array<Array<string | number>>
}

export async function salesRegister(db: ShowroomDB, range?: DateRange): Promise<Table> {
  const { invoices } = await loadDocs(db)
  const rows = invoices
    .filter((i) => !i.cancelled && inRange(i.date, range))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((i) => [
      i.number, i.date, i.docType, i.partyName, i.totalQty,
      i.taxableValue, i.cgst, i.sgst, i.igst, i.roundOff, i.grandTotal, i.paid,
      r2(i.grandTotal - i.paid), i.status, i.mode ?? '',
    ])
  return {
    name: 'sales-register',
    headers: ['Number', 'Date', 'Type', 'Party', 'Qty', 'Taxable', 'CGST', 'SGST', 'IGST', 'RoundOff', 'Total', 'Paid', 'Due', 'Status', 'Mode'],
    rows,
  }
}

export async function itemWiseReport(db: ShowroomDB, range?: DateRange): Promise<Table> {
  const rows = await topItems(db, range, 100000)
  return {
    name: 'item-wise-sale',
    headers: ['Item', 'Code', 'Qty', 'Amount', 'Profit'],
    rows: rows.map((r) => [r.name, r.code ?? '', r.qty, r.amount, r.profit]),
  }
}

export async function partyWiseReport(db: ShowroomDB, range?: DateRange): Promise<Table> {
  const rows = await topParties(db, range, 100000)
  return {
    name: 'party-wise-sale',
    headers: ['Party', 'Bills', 'Amount'],
    rows: rows.map((r) => [r.name, r.bills, r.amount]),
  }
}

export async function agingTable(db: ShowroomDB, side: 'customer' | 'supplier', asOf = today()): Promise<Table> {
  const rows = await agingReport(db, side, asOf)
  return {
    name: `aging-${side}`,
    headers: ['Party', 'Phone', '0-30', '31-60', '61-90', '90+', 'Total', 'Oldest (days)'],
    rows: rows.map((r) => [r.partyName, r.phone ?? '', r.buckets['0-30'], r.buckets['31-60'], r.buckets['61-90'], r.buckets['90+'], r.total, r.oldestDays]),
  }
}

export async function gstTable(db: ShowroomDB, range?: DateRange): Promise<Table> {
  const [byRate, byHsn] = await Promise.all([gstSummary(db, range), hsnSummary(db, range)])
  return {
    name: 'gst-summary',
    headers: ['Section', 'Key', 'Taxable', 'CGST', 'SGST', 'IGST', 'Tax', 'Qty', 'Total'],
    rows: [
      ...byRate.map((r) => [`GST ${r.gstPct}%`, `${r.gstPct}%`, r.taxable, r.cgst, r.sgst, r.igst, r.tax, '', r2(r.taxable + r.tax)]),
      ...byHsn.map((r) => ['HSN', r.hsn, r.taxable, '', '', '', r.tax, r.qty, r.total]),
    ],
  }
}

export async function dayBookTable(db: ShowroomDB, date: string): Promise<Table> {
  const { rows, totalIn, totalOut } = await dayBook(db, date)
  return {
    name: `daybook-${date}`,
    headers: ['Kind', 'Ref', 'Label', 'Party', 'In', 'Out', 'Detail'],
    rows: [
      ...rows.map((r) => [r.kind, r.ref, r.label, r.party, r.inAmount, r.outAmount, r.detail]),
      ['TOTAL', '', '', '', totalIn, totalOut, ''],
    ],
  }
}

export async function expenseTable(db: ShowroomDB, range?: DateRange): Promise<Table> {
  const { expenses } = await loadDocs(db)
  const rows = expenses.filter((e) => inRange(e.date, range)).sort((a, b) => b.date.localeCompare(a.date))
  return {
    name: 'expenses',
    headers: ['Date', 'Category', 'Amount', 'Mode', 'Note'],
    rows: rows.map((e) => [e.date, e.category, e.amount, e.mode, e.note ?? '']),
  }
}

export async function paymentRegister(db: ShowroomDB, range?: DateRange): Promise<Table> {
  const { payments } = await loadDocs(db)
  const rows = payments.filter((p) => inRange(p.date, range)).sort((a, b) => b.date.localeCompare(a.date))
  return {
    name: 'payments',
    headers: ['Date', 'Kind', 'Party', 'Bill', 'Amount', 'Mode', 'Ref', 'OnAccount', 'Note'],
    rows: rows.map((p) => [p.date, p.kind === 'in' ? 'IN' : 'OUT', p.partyName ?? '', p.invoiceNumber ?? '', p.amount, p.mode, p.ref ?? '', p.onAccount ? 'yes' : 'no', p.note ?? '']),
  }
}

export type { Expense, Invoice, Item, Party, Payment, PayMode }
