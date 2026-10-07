/**
 * Business layer — jahan app ki "asli" logic rehti hai.
 *
 * Sab kuch ek jaisa pattern follow karta hai:
 *   1. validate karo  2. Dexie transaction me likho  3. derived cheezein (stock, paid, status) dobara nikalo
 *
 * Derived values kabhi bhi "user ke bharose" nahi chhode jaate — stock, paid amount aur
 * bill status hamesha documents/payments se dobara calculate hote hain. Isse data
 * consistent rehta hai, chahe edit kisi bhi screen se hua ho.
 */
import type { ShowroomDB } from './db'
import { DOC_DEFAULT_PREFIX } from './db'
import { computeTotals, finalizeLine, isAccountedDoc, r2, statusOf, stockEffect } from './calc'
import { fyLabel } from './format'
import { keys } from './keys'
import { nowMs } from './util'
import type {
  Business, DiscountMode,
  DocSetting, DocType, Expense, ID, Invoice, InvoiceLine, Item, Party, PayKind, PayMode, Payment, User,
} from './types'

/* ------------------------------------------------------------------ */
/* Business / shop details                                             */
/* ------------------------------------------------------------------ */

export async function getBusiness(db: ShowroomDB): Promise<Business> {
  const row = await db.business.toCollection().first()
  if (row) return row
  const fresh: Business = {
    name: '',
    address: '',
    phone: '',
    gstin: '',
    state: 'Uttar Pradesh',
    stateCode: '09',
    createdAt: nowMs(),
    updatedAt: nowMs(),
  }
  return fresh
}

export async function saveBusiness(db: ShowroomDB, business: Business): Promise<void> {
  const payload = { ...business, updatedAt: nowMs() }
  const existing = await db.business.toCollection().first()
  if (existing?.id) await db.business.update(existing.id, payload)
  else await db.business.add(payload)
}

/* ------------------------------------------------------------------ */
/* Document numbering (INV/25-26/001)                                  */
/* ------------------------------------------------------------------ */

export function formatDocNumber(s: Pick<DocSetting, 'prefix' | 'nextNumber' | 'padding'>, fy = fyLabel()): string {
  const num = String(s.nextNumber).padStart(s.padding || 3, '0')
  return s.prefix ? `${s.prefix}/${fy}/${num}` : num
}

/** Setting row lo — FY badla to counter 1 se shuru */
async function docSettingRow(db: ShowroomDB, docType: DocType): Promise<DocSetting> {
  const row = await db.docSettings.where('docType').equals(docType).first()
  const fy = fyLabel()
  if (!row) {
    const fresh: DocSetting = { docType, prefix: DOC_DEFAULT_PREFIX[docType], nextNumber: 1, padding: 3, fy }
    const id = await db.docSettings.add(fresh)
    return { ...fresh, id }
  }
  if (row.fy !== fy) {
    const updated = { ...row, fy, nextNumber: 1 }
    if (row.id) await db.docSettings.update(row.id, { fy, nextNumber: 1 })
    return updated
  }
  return row
}

/** Agla number dikhane ke liye (counter badhega nahi) */
export async function peekDocNumber(db: ShowroomDB, docType: DocType): Promise<string> {
  const s = await docSettingRow(db, docType)
  return formatDocNumber(s)
}

/** Counter aage badha kar number do — save ke waqt */
async function consumeDocNumber(db: ShowroomDB, docType: DocType): Promise<string> {
  const s = await docSettingRow(db, docType)
  const number = formatDocNumber(s)
  if (s.id) await db.docSettings.update(s.id, { nextNumber: s.nextNumber + 1, fy: fyLabel() })
  return number
}

export async function saveDocSetting(db: ShowroomDB, docType: DocType, patch: Partial<DocSetting>): Promise<void> {
  const s = await docSettingRow(db, docType)
  const next: DocSetting = { ...s, ...patch, docType }
  if (s.id) await db.docSettings.update(s.id, next)
  else await db.docSettings.add(next)
}

export async function listDocSettings(db: ShowroomDB): Promise<DocSetting[]> {
  return db.docSettings.orderBy('docType').toArray()
}

/* ------------------------------------------------------------------ */
/* Tombstones — delete ko sync me bhi propagate karne ke liye          */
/* ------------------------------------------------------------------ */

export type TombTable = 'items' | 'parties' | 'invoices' | 'payments' | 'expenses'

/**
 * Delete marker likho. Key **natural key** hoti hai (item code / bill number…),
 * kabhi local id nahi — warna doosre phone ka id match ho kar galat delete ho jata.
 */
export async function markDeleted(db: ShowroomDB, table: TombTable, naturalKey: string): Promise<void> {
  const key = `${table}|${naturalKey}`
  const exists = await db.tombstones.where('key').equals(key).first()
  if (!exists) await db.tombstones.add({ key, at: nowMs() })
  // purane tombstones saaf karo (1 saal se purane kaam ke nahi)
  const all = await db.tombstones.count()
  if (all > 400) {
    const cutoff = nowMs() - 365 * 86_400_000
    const old = await db.tombstones.filter((t) => t.at < cutoff).toArray()
    for (const t of old) if (t.id) await db.tombstones.delete(t.id)
  }
}

export async function liveTombstones(db: ShowroomDB): Promise<string[]> {
  const rows = await db.tombstones.toArray()
  return rows.map((r) => r.key)
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export function emptyItem(): Item {
  const t = nowMs()
  return {
    code: '', name: '', barcode: '', brand: '', category: '', subCategory: '', hsn: '',
    unit: 'pc', mrp: 0, discountPct: 0, gstPct: 18, purchaseRate: 0, salePrice: 0,
    stock: 0, lowStockAlert: 5, createdAt: t, updatedAt: t,
  }
}

/** Code/barcode se item dhundo — billing screen ka quick lookup */
export async function findItem(db: ShowroomDB, text: string): Promise<Item | undefined> {
  const q = text.trim()
  if (!q) return undefined
  const byCode = await db.items.where('code').equals(q).first()
  if (byCode) return byCode
  const byBarcode = await db.items.where('barcode').equals(q).first()
  if (byBarcode) return byBarcode
  const lower = q.toLowerCase()
  const all = await db.items.toArray()
  return all.find((i) => i.name.toLowerCase() === lower) ?? all.find((i) => i.name.toLowerCase().includes(lower))
}

export async function saveItem(db: ShowroomDB, item: Item): Promise<ID> {
  const payload: Item = {
    ...item,
    code: item.code.trim(),
    name: item.name.trim(),
    barcode: (item.barcode || '').trim(),
    updatedAt: nowMs(),
  }
  if (!payload.name) throw new Error('Item ka naam likhein')
  if (!payload.code) {
    // code optional — auto bana do (SR001, SR002...)
    const count = await db.items.count()
    let n = count + 1
    let code = `SR${String(n).padStart(3, '0')}`
    while (await db.items.where('code').equals(code).first()) {
      n += 1
      code = `SR${String(n).padStart(3, '0')}`
    }
    payload.code = code
  }
  const clash = await db.items.where('code').equals(payload.code).first()
  if (clash && clash.id !== payload.id) throw new Error(`Code "${payload.code}" pehle se hai (${clash.name})`)
  if (payload.id) {
    await db.items.update(payload.id, payload)
    return payload.id
  }
  const { id: _drop, ...rest } = payload
  void _drop
  return db.items.add(rest as Item)
}

export async function deleteItem(db: ShowroomDB, id: ID): Promise<void> {
  await db.transaction('rw', db.items, db.tombstones, async () => {
    const item = await db.items.get(id)
    if (!item) return
    await db.items.delete(id)
    await markDeleted(db, 'items', keys.item(item))
  })
}

/** Stock badlo — bill/cancel/purchase sab yahi se guzarte hain */
async function applyStock(db: ShowroomDB, lines: InvoiceLine[], effect: -1 | 0 | 1): Promise<void> {
  if (effect === 0) return
  for (const line of lines) {
    if (!line.itemId) continue
    const item = await db.items.get(line.itemId)
    if (!item?.id) continue
    const next = r2(item.stock + effect * (Number(line.qty) || 0))
    await db.items.update(item.id, { stock: next, updatedAt: nowMs() })
  }
}

/* ------------------------------------------------------------------ */
/* Parties (khata)                                                     */
/* ------------------------------------------------------------------ */

export function emptyParty(type: Party['type'] = 'customer'): Party {
  return { type, name: '', phone: '', address: '', gstin: '', state: '', openingBalance: 0, createdAt: nowMs(), updatedAt: nowMs() }
}

export async function saveParty(db: ShowroomDB, party: Party): Promise<ID> {
  const payload: Party = { ...party, name: party.name.trim(), updatedAt: nowMs() }
  if (!payload.name) throw new Error('Party ka naam likhein')
  if (payload.id) {
    await db.parties.update(payload.id, payload)
    return payload.id
  }
  const { id: _drop, ...rest } = payload
  void _drop
  return db.parties.add(rest as Party)
}

export async function deleteParty(db: ShowroomDB, id: ID): Promise<void> {
  await db.transaction('rw', db.parties, db.tombstones, async () => {
    const party = await db.parties.get(id)
    if (!party) return
    await db.parties.delete(id)
    await markDeleted(db, 'parties', keys.party(party))
  })
}

export interface PartyDue {
  partyId: ID
  billed: number
  paid: number
  /** +ve = recover/pay karna hai, −ve = advance jama/diya */
  due: number
  invoices: number
  lastActivity?: string
}

/**
 * Party ka balance nikalo — ek hi formula se dono side (customer / supplier).
 *
 *   due = opening + sale bills + purchase bills − credit notes − jitna paisa aaya/gaya
 *
 *   customer ke liye: due > 0 = "lena hai", due < 0 = "advance jama"
 *   supplier ke liye: due > 0 = "dena hai", due < 0 = "advance diya"
 *
 * Har payment (in ya out) due ko kam karta hai — kyunki customer se paisa aana due kam karta hai,
 * aur supplier ko paisa dena bhi due kam karta hai.
 */
export function computeDue(party: Party, invoices: Invoice[], payments: Payment[]): PartyDue {
  const mine = invoices.filter((i) => i.partyId === party.id && !i.cancelled && isAccountedDoc(i.docType))
  const pays = payments.filter((p) => p.partyId === party.id)

  let sales = 0
  let purchases = 0
  let returns = 0
  let lastActivity: string | undefined

  for (const inv of mine) {
    if (inv.docType === 'purchase_bill') purchases += inv.grandTotal
    else if (inv.docType === 'credit_note') returns += inv.grandTotal
    else sales += inv.grandTotal
    if (!lastActivity || inv.date > lastActivity) lastActivity = inv.date
  }

  let paid = 0
  for (const p of pays) {
    paid += p.amount
    if (!lastActivity || p.date > lastActivity) lastActivity = p.date
  }

  const due = r2((party.openingBalance || 0) + sales + purchases - returns - paid)

  return {
    partyId: party.id as ID,
    billed: r2(sales + purchases - returns),
    paid: r2(paid),
    due,
    invoices: mine.length,
    lastActivity,
  }
}

/** Sab parties ka balance ek saath (Parties screen + reports) */
export async function allPartyDues(db: ShowroomDB): Promise<Map<ID, PartyDue>> {
  const [parties, invoices, payments] = await Promise.all([
    db.parties.orderBy('name').toArray(),
    db.invoices.toArray(),
    db.payments.toArray(),
  ])
  const map = new Map<ID, PartyDue>()
  for (const p of parties) {
    if (p.id) map.set(p.id, computeDue(p, invoices, payments))
  }
  return map
}

export interface LedgerRow {
  date: string
  kind: 'opening' | 'invoice' | 'payment'
  label: string
  ref: string
  debit: number
  credit: number
  /** running balance (lena hai / dena hai) */
  balance: number
}

/** Khata ledger — party ke saare bills, payments, opening balance, running balance ke saath */
export function buildLedger(party: Party, invoices: Invoice[], payments: Payment[]): { rows: LedgerRow[]; due: PartyDue } {
  const mine = invoices
    .filter((i) => i.partyId === party.id && !i.cancelled && isAccountedDoc(i.docType))
    .sort((a, b) => (a.date === b.date ? (a.id ?? 0) - (b.id ?? 0) : a.date.localeCompare(b.date)))
  const pays = payments
    .filter((p) => p.partyId === party.id)
    .sort((a, b) => (a.date === b.date ? (a.id ?? 0) - (b.id ?? 0) : a.date.localeCompare(b.date)))

  const rows: LedgerRow[] = []
  let balance = r2(party.openingBalance || 0)
  rows.push({ date: '', kind: 'opening', label: 'Opening balance (purana bakaya)', ref: '', debit: 0, credit: 0, balance })

  // Ek hi timeline me bills + payments (date-wise)
  const events: Array<{ date: string; seq: number; kind: 'invoice' | 'payment'; label: string; ref: string; effect: number }> = [
    ...mine.map((inv) => {
      const effect = inv.docType === 'credit_note' ? -inv.grandTotal : inv.grandTotal
      return { date: inv.date, seq: inv.id ?? 0, kind: 'invoice' as const, label: DOC_LABEL_FALLBACK(inv.docType), ref: inv.number, effect }
    }),
    ...pays.map((p) => ({
      date: p.date,
      seq: 100000 + (p.id ?? 0),
      kind: 'payment' as const,
      label: `${p.kind === 'in' ? 'Payment In' : 'Payment Out'} · ${p.mode}`,
      ref: p.invoiceNumber || (p.onAccount ? 'On account' : ''),
      effect: -p.amount,
    })),
  ].sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date)))

  for (const e of events) {
    balance = r2(balance + e.effect)
    rows.push({
      date: e.date,
      kind: e.kind,
      label: e.label,
      ref: e.ref,
      debit: e.effect > 0 ? e.effect : 0,
      credit: e.effect < 0 ? -e.effect : 0,
      balance,
    })
  }

  return { rows, due: computeDue(party, invoices, payments) }
}

/** Ledger me document type ka label (db.ts se import karne ke bajaye yahan chhota map —
 *  repo ko UI/db constant par depend nahi karna chahiye) */
function DOC_LABEL_FALLBACK(docType: DocType): string {
  const map: Record<DocType, string> = {
    tax_invoice: 'Tax Invoice',
    estimate: 'Estimate',
    proforma: 'Proforma Invoice',
    delivery_challan: 'Delivery Challan',
    bill_of_supply: 'Bill of Supply',
    credit_note: 'Credit Note',
    purchase_bill: 'Purchase Bill',
  }
  return map[docType]
}

/* ------------------------------------------------------------------ */
/* Invoices / documents                                                */
/* ------------------------------------------------------------------ */

export interface InvoiceInput {
  id?: ID
  docType: DocType
  date: string
  partyId?: ID
  partyName: string
  partyPhone?: string
  partyGstin?: string
  partyState?: string
  placeOfSupply?: string
  items: Array<Pick<InvoiceLine, 'itemId' | 'code' | 'name' | 'hsn' | 'unit' | 'qty' | 'rate' | 'discountPct' | 'gstPct'>>
  billDiscount: number
  billDiscountMode: DiscountMode
  extraCharges: number
  roundOff: boolean
  interState: boolean
  mode?: PayMode | 'credit'
  /** Billing ke waqt hi kitna paisa mila (khaali = poora) */
  paidAmount?: number
  note?: string
  /** Purchase bill me item ka cost update karna hai? */
  updateItemCost?: boolean
  createdBy?: string
}

export interface SaveInvoiceResult {
  invoice: Invoice
  payment?: Payment
}

/**
 * Invoice save — naya ho ya edit, dono case me stock theek se adjust hota hai
 * (purana effect hata kar naya lagaya jata hai).
 */
export async function saveInvoice(db: ShowroomDB, input: InvoiceInput, opts: { payment?: boolean } = {}): Promise<SaveInvoiceResult> {
  if (!input.items.length) throw new Error('Koi item add karein')

  const rawLines = input.items.filter((l) => l.name.trim() && Number(l.qty) > 0)
  if (!rawLines.length) throw new Error('Kam se kam ek item with qty likhein')

  // Cost snapshot: billing ke waqt item ka purchase rate line me freeze kar dete hain,
  // taaki baad me rate badalne par purani profit report na bigde.
  const costCache = new Map<ID, number>()
  const lines: InvoiceLine[] = []
  for (const l of rawLines) {
    let cost = (l as { cost?: number }).cost
    if (cost === undefined && l.itemId) {
      if (!costCache.has(l.itemId)) {
        const item = await db.items.get(l.itemId)
        costCache.set(l.itemId, item?.purchaseRate ?? 0)
      }
      cost = costCache.get(l.itemId) ?? 0
    }
    lines.push(finalizeLine({
      itemId: l.itemId,
      code: l.code ?? '',
      name: l.name,
      hsn: l.hsn,
      unit: l.unit ?? 'pc',
      qty: Number(l.qty) || 0,
      rate: Number(l.rate) || 0,
      discountPct: Number(l.discountPct) || 0,
      gstPct: Number(l.gstPct) || 0,
      cost: cost ?? 0,
    }))
  }

  const totals = computeTotals(lines, {
    billDiscount: input.billDiscount,
    billDiscountMode: input.billDiscountMode,
    extraCharges: input.extraCharges,
    interState: input.interState,
    roundOff: input.roundOff,
  })

  const effect = stockEffect(input.docType)

  return db.transaction('rw', db.invoices, db.payments, db.items, db.docSettings, db.appSettings, async () => {
    const existing = input.id ? await db.invoices.get(input.id) : undefined

    // 1. purane document ka stock effect ulta karo
    if (existing && !existing.cancelled) await applyStock(db, existing.lines, effect === 0 ? 0 : (effect * -1) as -1 | 0 | 1)

    const paidExisting = existing ? await recomputePaid(db, existing.id as ID) : 0
    const number = existing?.number ?? (await consumeDocNumber(db, input.docType))

    const invoice: Invoice = {
      id: existing?.id,
      docType: input.docType,
      number,
      date: input.date,
      partyId: input.partyId,
      partyName: input.partyName.trim(),
      partyPhone: input.partyPhone,
      partyGstin: input.partyGstin,
      partyState: input.partyState,
      placeOfSupply: input.placeOfSupply,
      lines,
      totalQty: totals.totalQty,
      subTotal: totals.subTotal,
      itemDiscount: totals.itemDiscount,
      billDiscount: totals.billDiscount,
      extraCharges: totals.extraCharges,
      taxableValue: totals.taxableValue,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
      paid: paidExisting,
      status: statusOf(totals.grandTotal, paidExisting),
      mode: input.mode,
      note: input.note,
      convertedFromId: existing?.convertedFromId,
      convertedToId: existing?.convertedToId,
      cancelled: existing?.cancelled,
      cancelReason: existing?.cancelReason,
      createdAt: existing?.createdAt ?? nowMs(),
      updatedAt: nowMs(),
      createdBy: existing?.createdBy ?? input.createdBy,
    }

    let id: ID
    if (invoice.id) {
      await db.invoices.put(invoice)
      id = invoice.id
    } else {
      const { id: _drop, ...rest } = invoice
      void _drop
      id = await db.invoices.add(rest as Invoice)
    }
    invoice.id = id

    // 2. naya stock effect lagao
    if (!invoice.cancelled) await applyStock(db, lines, effect)

    // 3. purchase me item ka cost update (optional)
    if (input.updateItemCost && input.docType === 'purchase_bill') {
      for (const l of lines) {
        if (!l.itemId) continue
        const item = await db.items.get(l.itemId)
        if (item?.id) await db.items.update(item.id, { purchaseRate: l.rate, updatedAt: nowMs() })
      }
    }

    // 4. billing ke waqt hi payment liya (cash/UPI/card...) to payment record bana do —
    //    register aur khata dono me dikhega, aur "paidal" entry nahi banegi.
    let payment: Payment | undefined
    const wantPayment = opts.payment !== false
    const isPurchase = input.docType === 'purchase_bill'
    const payableDoc = ['tax_invoice', 'bill_of_supply', 'credit_note', 'purchase_bill'].includes(input.docType)
    const amountNow = input.paidAmount === undefined ? totals.grandTotal : Math.min(Math.max(0, input.paidAmount), totals.grandTotal)
    if (wantPayment && !existing && payableDoc && input.mode && input.mode !== 'credit' && amountNow > 0) {
      payment = {
        kind: isPurchase ? 'out' : 'in',
        date: input.date,
        partyId: input.partyId,
        partyName: input.partyName,
        invoiceId: id,
        invoiceNumber: number,
        amount: r2(amountNow),
        mode: input.mode,
        onAccount: false,
        note: 'Bill ke saath',
        createdAt: nowMs(),
        updatedAt: nowMs(),
        createdBy: input.createdBy,
      }
      const { id: _p, ...payRest } = payment
      void _p
      const pid = await db.payments.add(payRest as Payment)
      payment.id = pid
      const paid = await recomputePaid(db, id)
      await db.invoices.update(id, { paid, status: statusOf(totals.grandTotal, paid) })
      invoice.paid = paid
      invoice.status = statusOf(totals.grandTotal, paid)
    }

    return { invoice, payment }
  })
}

/** payments se invoice ka paid amount dobara nikalo */
async function recomputePaid(db: ShowroomDB, invoiceId: ID): Promise<number> {
  const inv = await db.invoices.get(invoiceId)
  if (!inv) return 0
  const rows = await db.payments.where('invoiceId').equals(invoiceId).toArray()
  const isPurchase = inv.docType === 'purchase_bill'
  let paid = 0
  for (const p of rows) {
    const sameDir = isPurchase ? p.kind === 'out' : p.kind === 'in'
    paid += sameDir ? p.amount : -p.amount
  }
  return r2(paid)
}

export async function refreshInvoicePaid(db: ShowroomDB, invoiceId: ID): Promise<void> {
  const inv = await db.invoices.get(invoiceId)
  if (!inv?.id) return
  const paid = await recomputePaid(db, invoiceId)
  await db.invoices.update(inv.id, { paid, status: statusOf(inv.grandTotal, paid), updatedAt: nowMs() })
}

/** Bill cancel — stock wapas, document report se hat gaya (record rehta hai) */
export async function cancelInvoice(db: ShowroomDB, id: ID, reason = ''): Promise<void> {
  await db.transaction('rw', db.invoices, db.items, async () => {
    const inv = await db.invoices.get(id)
    if (!inv?.id || inv.cancelled) return
    const effect = stockEffect(inv.docType)
    if (effect !== 0) await applyStock(db, inv.lines, (effect * -1) as -1 | 0 | 1)
    await db.invoices.update(id, { cancelled: true, cancelReason: reason, updatedAt: nowMs() })
  })
}

/** Delete — stock wapas + payments delete + tombstone (sync ke liye) */
export async function deleteInvoice(db: ShowroomDB, id: ID): Promise<void> {
  await db.transaction('rw', db.invoices, db.items, db.payments, db.tombstones, async () => {
    const inv = await db.invoices.get(id)
    if (!inv?.id) return
    if (!inv.cancelled) {
      const effect = stockEffect(inv.docType)
      if (effect !== 0) await applyStock(db, inv.lines, (effect * -1) as -1 | 0 | 1)
    }
    const pays = await db.payments.where('invoiceId').equals(id).toArray()
    for (const p of pays) {
      if (p.id) {
        await db.payments.delete(p.id)
        await markDeleted(db, 'payments', keys.payment(p))
      }
    }
    await db.invoices.delete(id)
    await markDeleted(db, 'invoices', keys.invoice(inv))
  })
}

/** Estimate → Tax Invoice (ya koi bhi conversion) */
export async function convertInvoice(db: ShowroomDB, id: ID, toType: DocType, date?: string): Promise<ID> {
  const src = await db.invoices.get(id)
  if (!src) throw new Error('Document nahi mila')
  const result = await saveInvoice(db, {
    docType: toType,
    date: date ?? src.date,
    partyId: src.partyId,
    partyName: src.partyName,
    partyPhone: src.partyPhone,
    partyGstin: src.partyGstin,
    partyState: src.partyState,
    placeOfSupply: src.placeOfSupply,
    items: src.lines,
    billDiscount: src.billDiscount,
    billDiscountMode: 'amount',
    extraCharges: src.extraCharges,
    roundOff: src.roundOff !== 0,
    interState: src.igst > 0,
    mode: 'credit',
    note: src.note,
    createdBy: src.createdBy,
  })
  // billing ke saath payment nahi banayi — estimate se convert hota hai to udhaar/bill hi rehta hai
  await db.invoices.update(result.invoice.id as ID, { convertedFromId: id, updatedAt: nowMs() })
  await db.invoices.update(id, { convertedToId: result.invoice.id, updatedAt: nowMs() })
  return result.invoice.id as ID
}

/** Bill duplicate — same items, naya number, aaj ki date */
export async function duplicateInvoice(db: ShowroomDB, id: ID, date?: string): Promise<ID> {
  const src = await db.invoices.get(id)
  if (!src) throw new Error('Document nahi mila')
  const result = await saveInvoice(db, {
    docType: src.docType,
    date: date ?? src.date,
    partyId: src.partyId,
    partyName: src.partyName,
    partyPhone: src.partyPhone,
    partyGstin: src.partyGstin,
    partyState: src.partyState,
    placeOfSupply: src.placeOfSupply,
    items: src.lines,
    billDiscount: src.billDiscount,
    billDiscountMode: 'amount',
    extraCharges: src.extraCharges,
    roundOff: src.roundOff !== 0,
    interState: src.igst > 0,
    mode: 'credit',
    note: src.note,
    createdBy: src.createdBy,
  })
  return result.invoice.id as ID
}

/** Sales return / credit note — bill se banao (full ya partial qty) */
export async function creditNoteFromInvoice(db: ShowroomDB, id: ID, date?: string): Promise<ID> {
  const src = await db.invoices.get(id)
  if (!src) throw new Error('Bill nahi mila')
  const result = await saveInvoice(db, {
    docType: 'credit_note',
    date: date ?? src.date,
    partyId: src.partyId,
    partyName: src.partyName,
    partyPhone: src.partyPhone,
    partyGstin: src.partyGstin,
    partyState: src.partyState,
    placeOfSupply: src.placeOfSupply,
    items: src.lines,
    billDiscount: src.billDiscount,
    billDiscountMode: 'amount',
    extraCharges: 0,
    roundOff: src.roundOff !== 0,
    interState: src.igst > 0,
    mode: 'credit',
    note: `${src.number} ka return`,
    createdBy: src.createdBy,
  })
  await db.invoices.update(result.invoice.id as ID, { convertedFromId: id, updatedAt: nowMs() })
  return result.invoice.id as ID
}

/* ------------------------------------------------------------------ */
/* Payments in / out                                                   */
/* ------------------------------------------------------------------ */

export interface PaymentInput {
  kind: PayKind
  date: string
  partyId?: ID
  partyName?: string
  invoiceId?: ID
  invoiceNumber?: string
  amount: number
  mode: PayMode
  ref?: string
  note?: string
  createdBy?: string
}

/** Payment entry — bill ke against ya on-account (advance) */
export async function addPayment(db: ShowroomDB, input: PaymentInput): Promise<ID> {
  if (!(Number(input.amount) > 0)) throw new Error('Amount 0 se bada hona chahiye')
  return db.transaction('rw', db.payments, db.invoices, async () => {
    const payment: Payment = {
      kind: input.kind,
      date: input.date,
      partyId: input.partyId,
      partyName: input.partyName,
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      amount: r2(input.amount),
      mode: input.mode,
      ref: input.ref,
      note: input.note,
      onAccount: !input.invoiceId,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      createdBy: input.createdBy,
    }
    const { id: _drop, ...rest } = payment
    void _drop
    const id = await db.payments.add(rest as Payment)
    if (input.invoiceId) await refreshInvoicePaid(db, input.invoiceId)
    return id
  })
}

export async function deletePayment(db: ShowroomDB, id: ID): Promise<void> {
  await db.transaction('rw', db.payments, db.invoices, db.tombstones, async () => {
    const p = await db.payments.get(id)
    if (!p) return
    await db.payments.delete(id)
    await markDeleted(db, 'payments', keys.payment(p))
    if (p.invoiceId) await refreshInvoicePaid(db, p.invoiceId)
  })
}

/** Kisi party ke liye uske bill ke against bache hue paise (payment screen ka dropdown) */
export async function openInvoicesOfParty(db: ShowroomDB, partyId: ID, kind: PayKind): Promise<Invoice[]> {
  const list = await db.invoices.where('partyId').equals(partyId).toArray()
  const wantType: DocType[] = kind === 'out' ? ['purchase_bill'] : ['tax_invoice', 'bill_of_supply']
  return list
    .filter((i) => !i.cancelled && wantType.includes(i.docType) && r2(i.grandTotal - i.paid) > 0.009)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

export async function saveExpense(db: ShowroomDB, expense: Expense): Promise<ID> {
  if (!(Number(expense.amount) > 0)) throw new Error('Kharcha ka amount likhein')
  const payload: Expense = { ...expense, amount: r2(expense.amount), updatedAt: nowMs() }
  if (payload.id) {
    await db.expenses.update(payload.id, payload)
    return payload.id
  }
  const { id: _drop, ...rest } = payload
  void _drop
  return db.expenses.add(rest as Expense)
}

export async function deleteExpense(db: ShowroomDB, id: ID): Promise<void> {
  await db.transaction('rw', db.expenses, db.tombstones, async () => {
    const expense = await db.expenses.get(id)
    if (!expense) return
    await db.expenses.delete(id)
    await markDeleted(db, 'expenses', keys.expense(expense))
  })
}

/* ------------------------------------------------------------------ */
/* Users & PIN (offline login)                                         */
/* ------------------------------------------------------------------ */

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** SHA-256(pin) — WebCrypto na ho (http/file://) to fallback hash */
export async function hashPin(pin: string): Promise<string> {
  const data = `showroom::${pin}`
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
      return `sha256:${toHex(buf)}`
    }
  } catch {
    /* fallback neeche */
  }
  // Fallback: FNV-1a 32-bit (local deterrent ke liye kaafi; PIN 4-6 digit hi hota hai)
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i += 1) {
    h ^= data.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `fnv1a:${h.toString(16)}`
}

export async function createUser(db: ShowroomDB, name: string, role: User['role'], pin: string): Promise<ID> {
  if (!name.trim()) throw new Error('Naam likhein')
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN 4 se 6 ank ka hona chahiye')
  const users = await db.users.count()
  const user: User = {
    name: name.trim(),
    role: users === 0 ? 'owner' : role,
    pinHash: await hashPin(pin),
    active: true,
    createdAt: nowMs(),
  }
  return db.users.add(user)
}

export async function verifyUserPin(db: ShowroomDB, userId: ID, pin: string): Promise<boolean> {
  const user = await db.users.get(userId)
  if (!user) return false
  return user.pinHash === (await hashPin(pin))
}

export async function updateUserPin(db: ShowroomDB, userId: ID, pin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN 4 se 6 ank ka hona chahiye')
  await db.users.update(userId, { pinHash: await hashPin(pin) })
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

/** Sab kuch mita do (naya DB jaisa) */
export async function clearAllData(db: ShowroomDB): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear()
  })
}
