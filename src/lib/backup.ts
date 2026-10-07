/**
 * Backup / restore (JSON) — file ke through, aur cloud sync bhi isi shape ka
 * snapshot use karta hai (ek hi format, do jagah kaam aata hai).
 */
import type { ShowroomDB } from './db'
import { getSetting, setSetting, APP_SETTINGS } from './db'
import { nowMs } from './util'
import type { AppSetting, Business, DocSetting, Expense, Invoice, Item, Party, Payment, User } from './types'
import type { Tombstone } from './db'

export interface SnapshotData {
  business: Business[]
  items: Item[]
  parties: Party[]
  invoices: Invoice[]
  payments: Payment[]
  expenses: Expense[]
  docSettings: DocSetting[]
  appSettings: AppSetting[]
  users: User[]
  tombstones: Tombstone[]
}

export interface CompanySnapshot {
  app: 'showroom-manager'
  version: 2
  companyId: string
  companyName: string
  exportedAt: number
  rev: number
  data: SnapshotData
}

/** Ye settings device-specific hain — backup/restore/cloud me nahi jati */
const DEVICE_LOCAL_KEYS = [APP_SETTINGS.cloudConfig, APP_SETTINGS.syncEnabled, APP_SETTINGS.syncAccount, APP_SETTINGS.lastSyncAt, APP_SETTINGS.lastBackupAt]

export async function buildSnapshot(db: ShowroomDB, companyId: string, companyName: string): Promise<CompanySnapshot> {
  const [business, items, parties, invoices, payments, expenses, docSettings, appSettings, users, tombstones] = await Promise.all([
    db.business.toArray(),
    db.items.toArray(),
    db.parties.toArray(),
    db.invoices.toArray(),
    db.payments.toArray(),
    db.expenses.toArray(),
    db.docSettings.toArray(),
    db.appSettings.toArray(),
    db.users.toArray(),
    db.tombstones.toArray(),
  ])
  const rev = Number((await getSetting(db, 'rev')) ?? '0') || 0
  return {
    app: 'showroom-manager',
    version: 2,
    companyId,
    companyName,
    exportedAt: nowMs(),
    rev,
    data: {
      business,
      items,
      parties,
      invoices,
      payments,
      expenses,
      docSettings,
      appSettings: appSettings.filter((s) => !DEVICE_LOCAL_KEYS.includes(s.key as (typeof DEVICE_LOCAL_KEYS)[number])),
      users,
      tombstones,
    },
  }
}

export interface RestoreResult {
  restored: Record<string, number>
  warnings: string[]
}

/** Snapshot ko DB me daalo (purana data mit jayega — pehle backup le lein) */
export async function restoreSnapshot(db: ShowroomDB, snap: CompanySnapshot, opts: { clear?: boolean } = {}): Promise<RestoreResult> {
  if (snap.app !== 'showroom-manager') throw new Error('Ye Showroom Manager ka backup nahi hai')
  const warnings: string[] = []
  const restored: Record<string, number> = {}

  await db.transaction('rw', db.tables, async () => {
    if (opts.clear !== false) {
      for (const t of db.tables) await t.clear()
    }
    const put = async (table: keyof SnapshotData) => {
      const rows = (snap.data?.[table] ?? []) as Array<{ id?: number }>
      if (!rows.length) return
      const target = db.table(table)
      await target.bulkPut(rows)
      restored[table] = rows.length
    }
    await put('business')
    await put('items')
    await put('parties')
    await put('invoices')
    await put('payments')
    await put('expenses')
    await put('docSettings')
    await put('users')
    await put('tombstones')
    // appSettings: device-local keys chhod do
    const settings = (snap.data?.appSettings ?? []).filter((s) => !DEVICE_LOCAL_KEYS.includes(s.key as (typeof DEVICE_LOCAL_KEYS)[number]))
    if (settings.length) {
      await db.appSettings.bulkPut(settings)
      restored.appSettings = settings.length
    }
  })

  if (!snap.data?.docSettings?.length) warnings.push('Document number series backup me nahi thi — default series ban gayi')
  await setSetting(db, 'rev', String(snap.rev || 0))
  return { restored, warnings }
}

export function snapshotToBlob(snap: CompanySnapshot): Blob {
  return new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
}

export function parseSnapshot(text: string): CompanySnapshot {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('File padhi nahi ja saki — sahi JSON backup file chunein')
  }
  const snap = json as CompanySnapshot
  if (!snap || typeof snap !== 'object' || snap.app !== 'showroom-manager') {
    throw new Error('Ye file Showroom Manager ke backup ki nahi lagti')
  }
  return snap
}

/** rev counter badhao (sync ke liye — har write par) */
export async function bumpRev(db: ShowroomDB): Promise<number> {
  const rev = (Number((await getSetting(db, 'rev')) ?? '0') || 0) + 1
  await setSetting(db, 'rev', String(rev))
  return rev
}
