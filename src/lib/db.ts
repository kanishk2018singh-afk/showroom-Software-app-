/**
 * Dexie (IndexedDB) layer — ek company = ek alag database.
 *
 * Kyun? MyBillBook jaisa multi-firm: har firm ka data bilkul alag rehta hai
 * (items, bills, khata, users). Ek DB me sab rakhke companyId filter karna
 * risk bhara hai (ek filter bhoole to dusri firm ka data dikh jayega) — isliye
 * physical separation use kiya gaya hai.
 *
 * `db` ek lazy proxy hai jo current company ka database deta hai, taaki
 * kisi bhi screen me sirf `db.items.toArray()` likhna kaafi ho.
 */
import Dexie, { type Table } from 'dexie'
import type {
  AppSetting, Business, DocSetting, DocType, Expense, Invoice, Item, Party, Payment, User,
} from './types'
import { nowMs, uid } from './util'
import { fyLabel } from './format'

const COMPANY_KEY = 'showroom:currentCompany'
const COMPANIES_KEY = 'showroom:companies'

export interface CompanyMeta {
  id: string
  name: string
  createdAt: number
}

export interface Tombstone {
  id?: number
  /** "items:12" / "invoices:4" — sync me delete propagate karne ke liye */
  key: string
  at: number
}

export class ShowroomDB extends Dexie {
  business!: Table<Business, number>
  items!: Table<Item, number>
  parties!: Table<Party, number>
  invoices!: Table<Invoice, number>
  payments!: Table<Payment, number>
  expenses!: Table<Expense, number>
  docSettings!: Table<DocSetting, number>
  appSettings!: Table<AppSetting, number>
  users!: Table<User, number>
  tombstones!: Table<Tombstone, number>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      business: '++id',
      items: '++id, code, name, category, barcode, updatedAt',
      parties: '++id, name, type, phone, updatedAt',
      invoices: '++id, docType, number, date, partyId, status, cancelled, convertedFromId',
      payments: '++id, date, partyId, invoiceId, kind, mode',
      expenses: '++id, date, category, mode',
      docSettings: '++id, &docType',
      appSettings: '++id, &key',
      users: '++id, name, role',
    })
    // v2 — cloud sync ke liye tombstones (delete propagate) + payment reverse link
    this.version(2).stores({
      tombstones: '++id, &key, at',
      payments: '++id, date, partyId, invoiceId, kind, mode, onAccount',
      invoices: '++id, docType, number, date, partyId, status, cancelled, convertedFromId, updatedAt',
    })
  }
}

/** Company registry (localStorage — device-level, data nahi) */
export function listCompanies(): CompanyMeta[] {
  try {
    const raw = localStorage.getItem(COMPANIES_KEY)
    const arr = raw ? (JSON.parse(raw) as CompanyMeta[]) : []
    if (arr.length) return arr
  } catch {
    /* ignore */
  }
  const first: CompanyMeta = { id: 'default', name: 'Meri Dukaan', createdAt: nowMs() }
  localStorage.setItem(COMPANIES_KEY, JSON.stringify([first]))
  return [first]
}

export function saveCompanies(list: CompanyMeta[]): void {
  localStorage.setItem(COMPANIES_KEY, JSON.stringify(list))
}

export function currentCompanyId(): string {
  const saved = localStorage.getItem(COMPANY_KEY)
  if (saved && listCompanies().some((c) => c.id === saved)) return saved
  const first = listCompanies()[0]
  localStorage.setItem(COMPANY_KEY, first.id)
  return first.id
}

export function setCurrentCompany(id: string): void {
  localStorage.setItem(COMPANY_KEY, id)
}

export function companyDbName(id: string): string {
  return id === 'default' ? 'showroom-db' : `showroom-db-${id}`
}

/** Naya company banao (localStorage registry + khaali DB) */
export function createCompany(name: string): CompanyMeta {
  const list = listCompanies()
  const meta: CompanyMeta = { id: uid('co'), name: name.trim() || 'Nayi Company', createdAt: nowMs() }
  saveCompanies([...list, meta])
  return meta
}

export function renameCompany(id: string, name: string): void {
  saveCompanies(listCompanies().map((c) => (c.id === id ? { ...c, name } : c)))
}

export function deleteCompanyMeta(id: string): void {
  const list = listCompanies().filter((c) => c.id !== id)
  saveCompanies(list.length ? list : [{ id: 'default', name: 'Meri Dukaan', createdAt: nowMs() }])
  if (currentCompanyId() === id) setCurrentCompany(listCompanies()[0].id)
}

const cache = new Map<string, ShowroomDB>()

export function dbFor(companyId: string): ShowroomDB {
  let db = cache.get(companyId)
  if (!db) {
    db = new ShowroomDB(companyDbName(companyId))
    cache.set(companyId, db)
  }
  return db
}

/**
 * Current company ka DB. Screens/dexie hooks isi ko use karte hain.
 * (Proxy ki jagah plain getter — Dexie ke liveQuery ko static object chahiye,
 * isliye app ek company me rehte hue DB object ko cache karti hai.)
 */
export function getDb(): ShowroomDB {
  return dbFor(currentCompanyId())
}

export const APP_SETTINGS = {
  onboarded: 'onboarded',
  cloudConfig: 'cloudConfig',
  syncEnabled: 'syncEnabled',
  lastSyncAt: 'lastSyncAt',
  syncAccount: 'syncAccount',
  autoPrint: 'autoPrintAfterSave',
  lastBackupAt: 'lastBackupAt',
} as const

export const DOC_DEFAULT_PREFIX: Record<DocType, string> = {
  tax_invoice: 'INV',
  estimate: 'EST',
  proforma: 'PRO',
  delivery_challan: 'DC',
  bill_of_supply: 'BOS',
  credit_note: 'CN',
  purchase_bill: 'PUR',
}

export const DOC_LABEL: Record<DocType, string> = {
  tax_invoice: 'Tax Invoice',
  estimate: 'Estimate',
  proforma: 'Proforma Invoice',
  delivery_challan: 'Delivery Challan',
  bill_of_supply: 'Bill of Supply',
  credit_note: 'Credit Note / Return',
  purchase_bill: 'Purchase Bill',
}

export const DOC_SHORT: Record<DocType, string> = {
  tax_invoice: 'Invoice',
  estimate: 'Estimate',
  proforma: 'Proforma',
  delivery_challan: 'Challan',
  bill_of_supply: 'Bill of Supply',
  credit_note: 'Credit Note',
  purchase_bill: 'Purchase',
}

export const ALL_DOC_TYPES: DocType[] = [
  'tax_invoice',
  'estimate',
  'proforma',
  'delivery_challan',
  'bill_of_supply',
  'credit_note',
  'purchase_bill',
]

export const EXPENSE_CATEGORIES = [
  'Kiraya (Rent)',
  'Staff / Salary',
  'Bijli / Mobile',
  'Transport / Freight',
  'Packing',
  'Marketing',
  'Repair / Maintenance',
  'Chai-Paani',
  'Other',
] as const

export const PAY_MODES = ['cash', 'upi', 'card', 'bank', 'cheque'] as const

export const PAY_MODE_LABEL: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank',
  cheque: 'Cheque',
  credit: 'Udhaar',
}

/** Healper: setting padho (string) */
export async function getSetting(db: ShowroomDB, key: string): Promise<string | null> {
  const row = await db.appSettings.where('key').equals(key).first()
  return row?.value ?? null
}

export async function setSetting(db: ShowroomDB, key: string, value: string): Promise<void> {
  const row = await db.appSettings.where('key').equals(key).first()
  if (row?.id) await db.appSettings.update(row.id, { value })
  else await db.appSettings.add({ key, value })
}

/**
 * Naya DB kholte hi: doc number settings + defaults bana do.
 * Sample items sirf pehli (default) company me aate hain.
 */
export async function ensureBootstrap(db: ShowroomDB, opts: { seedItems: boolean }): Promise<void> {
  const count = await db.docSettings.count()
  if (count === 0) {
    const fy = fyLabel()
    await db.docSettings.bulkAdd(
      ALL_DOC_TYPES.map((docType) => ({
        docType,
        prefix: DOC_DEFAULT_PREFIX[docType],
        nextNumber: 1,
        padding: 3,
        fy,
      } as DocSetting)),
    )
  }
  await setSetting(db, 'schemaVersion', '2')
  if (opts.seedItems && (await db.items.count()) === 0 && (await db.invoices.count()) === 0) {
    await db.items.bulkAdd(SAMPLE_ITEMS())
  }
}

/** Demo items — sirf first run par (naya bill banate waqt testing aasan) */
export function SAMPLE_ITEMS(): Item[] {
  const t = nowMs()
  const base = {
    unit: 'pc', discountPct: 0, gstPct: 18, lowStockAlert: 5, createdAt: t, updatedAt: t,
  }
  return [
    { ...base, code: 'S001', name: 'Steel Dinner Set (6 pc)', brand: 'Sunshine', category: 'Steel', subCategory: 'Dinner Set', hsn: '7323', mrp: 999, salePrice: 899, purchaseRate: 620, stock: 24 },
    { ...base, code: 'S002', name: 'Non-stick Kadhai 24cm', brand: 'Prestige', category: 'Non-stick', subCategory: 'Cookware', hsn: '7615', mrp: 1250, salePrice: 1099, purchaseRate: 780, stock: 12 },
    { ...base, code: 'S003', name: 'Mixer Grinder 750W', brand: 'Bajaj', category: 'Appliances', subCategory: 'Mixer', hsn: '8509', mrp: 3499, salePrice: 2899, purchaseRate: 2150, stock: 7, gstPct: 18 },
    { ...base, code: 'S004', name: 'Cotton Bedsheet Double', brand: 'Bombay Dyeing', category: 'Home', subCategory: 'Bedsheet', hsn: '6302', mrp: 899, salePrice: 699, purchaseRate: 430, stock: 40, gstPct: 5 },
    { ...base, code: 'S005', name: 'Pressure Cooker 5L', brand: 'Hawkins', category: 'Steel', subCategory: 'Cooker', hsn: '7615', mrp: 2100, salePrice: 1799, purchaseRate: 1350, stock: 3 },
    { ...base, code: 'S006', name: 'Electric Kettle 1.5L', brand: 'Pigeon', category: 'Appliances', subCategory: 'Kettle', hsn: '8516', mrp: 1099, salePrice: 849, purchaseRate: 560, stock: 15 },
    { ...base, code: 'S007', name: 'Glass Set 6 pc', brand: 'Ocean', category: 'Glassware', subCategory: 'Glass Set', hsn: '7013', mrp: 649, salePrice: 549, purchaseRate: 350, discountPct: 5, stock: 30, gstPct: 18 },
  ].map((it) => ({ ...it, barcode: `89012${it.code.slice(1)}00` }))
}
