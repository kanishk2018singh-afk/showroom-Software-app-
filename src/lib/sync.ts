/**
 * Sync — do phone ke beech data merge.
 *
 * Rules (README me likhe hue, aur yahan exactly implement):
 *  • Natural key par match: item code, bill number, party naam, payment (date+amount+mode+bill),
 *    kharcha (date+category+amount+mode), user naam.
 *  • "Naya wala jeetta hai": updatedAt bada ho to wo row jeet jati hai.
 *  • Sirf ek taraf ho to jud jati hai.
 *  • ID clash ho to naya ID milta hai, aur invoice/payment ke references (partyId, itemId)
 *    apne aap theek ho jate hain.
 *  • Delete tombstones se propagate hoti hai (warna delete ki hui cheez wapas aa jati).
 */
import type { ShowroomDB } from './db'
import { createCompany, getSetting, listCompanies, setSetting, APP_SETTINGS, companyDbName, dbFor, saveCompanies } from './db'
import { buildSnapshot, restoreSnapshot, type CompanySnapshot } from './backup'
import { nowMs } from './util'
import type { CloudConfig, CloudSession } from './cloud'
import { ensureFresh, listRemoteCompanies, pullSnapshot, pushSnapshot } from './cloud'
import type { AppSetting, Business, DocSetting, Expense, Invoice, Item, Party, Payment, User } from './types'
import type { Tombstone } from './db'
import type { Table } from 'dexie'
import { keys } from './keys'

export interface MergeReport {
  added: Record<string, number>
  updated: Record<string, number>
  skipped: Record<string, number>
}

const emptyReport = (): MergeReport => ({ added: {}, updated: {}, skipped: {} })
const bump = (bag: Record<string, number>, key: string) => {
  bag[key] = (bag[key] ?? 0) + 1
}

function tombstoneMap(rows: Tombstone[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const t of rows) map.set(t.key, Math.max(map.get(t.key) ?? 0, t.at))
  return map
}

interface MergeContext {
  report: MergeReport
  /** remote id → local id (invoice/payment ke references theek karne ke liye) */
  itemIds: Map<number, number>
  partyIds: Map<number, number>
  invoiceIds: Map<number, number>
  tombstones: Map<string, number>
}

interface Row {
  id?: number
  createdAt?: number
  updatedAt?: number
}

/**
 * Ek table ka merge:
 *   natural key par match → "naya wala jeetta hai" → ID clash par naya ID →
 *   tombstones dono taraf apply (delete propagate).
 */
async function mergeTable<T extends Row>(
  table: Table<T, number>,
  name: string,
  keyOf: (row: T) => string,
  remoteRows: T[],
  ctx: MergeContext,
  localWins: boolean,
  opts: { remap?: (row: T) => T; idMap?: Map<number, number> } = {},
): Promise<void> {
  const localRows = await table.toArray()
  const byKey = new Map<string, T>()
  const usedIds = new Set<number>()
  for (const row of localRows) {
    byKey.set(keyOf(row), row)
    if (row.id !== undefined) usedIds.add(row.id)
  }

  // 1) jo local rows doosre device par delete hui thi — unhe yahan se bhi hata do
  //    (tombstone key ka format: "items|item:del1" — isliye table prefix lagta hai)
  for (const local of localRows) {
    const at = ctx.tombstones.get(`${name}|${keyOf(local)}`)
    if (at === undefined || at < keys.version(local)) continue
    if (local.id !== undefined) {
      await table.delete(local.id)
      usedIds.delete(local.id)
    }
    byKey.delete(keyOf(local))
    bump(ctx.report.skipped, `${name}(deleted)`)
  }

  // 2) remote rows merge karo
  for (const remoteRaw of remoteRows) {
    const remote = opts.remap ? opts.remap(remoteRaw) : remoteRaw
    const key = keyOf(remote)
    const version = keys.version(remote)
    const tombAt = ctx.tombstones.get(`${name}|${key}`)
    if (tombAt !== undefined && tombAt >= version) continue

    const local = byKey.get(key)
    if (!local) {
      const payload = { ...remote } as T & { id?: number }
      if (payload.id !== undefined && usedIds.has(payload.id)) delete payload.id
      const newId = await table.add(payload as T)
      usedIds.add(newId)
      byKey.set(key, { ...payload, id: newId } as T)
      bump(ctx.report.added, name)
      if (remoteRaw.id !== undefined && opts.idMap) opts.idMap.set(remoteRaw.id, newId)
      continue
    }

    if (!localWins && version > keys.version(local)) {
      await table.put({ ...remote, id: local.id } as T)
      bump(ctx.report.updated, name)
    } else {
      bump(ctx.report.skipped, name)
    }
    if (remoteRaw.id !== undefined && opts.idMap) opts.idMap.set(remoteRaw.id, local.id as number)
  }
}

/**
 * Remote snapshot ko local DB me merge karo.
 * `localWins` true ho to local rows apne aap jeette hain (sirf missing rows judte hain).
 */
export async function mergeSnapshot(db: ShowroomDB, snap: CompanySnapshot, opts: { localWins?: boolean } = {}): Promise<MergeReport> {
  const localWins = !!opts.localWins
  const ctx: MergeContext = {
    report: emptyReport(),
    itemIds: new Map(),
    partyIds: new Map(),
    invoiceIds: new Map(),
    tombstones: new Map(),
  }

  const data = snap.data ?? ({} as CompanySnapshot['data'])
  const localTombstones = await db.tombstones.toArray()
  ctx.tombstones = tombstoneMap([...localTombstones, ...(data.tombstones ?? [])])

  if (data.tombstones?.length) {
    const merged = [...ctx.tombstones.entries()].map(([key, at]) => ({ key, at }))
    await db.tombstones.clear()
    await db.tombstones.bulkAdd(merged)
  }

  await db.transaction('rw', db.tables, async () => {
    // Order maayne rakhta hai: items/parties pehle (id maps banti hain), phir invoices, payments, expenses
    await mergeTable(db.items as Table<Item, number>, 'items', keys.item, data.items ?? [], ctx, localWins, { idMap: ctx.itemIds })
    await mergeTable(db.parties as Table<Party, number>, 'parties', keys.party, data.parties ?? [], ctx, localWins, { idMap: ctx.partyIds })

    const remapInvoice = (inv: Invoice): Invoice => ({
      ...inv,
      partyId: inv.partyId !== undefined ? (ctx.partyIds.get(inv.partyId) ?? inv.partyId) : undefined,
      lines: inv.lines.map((l) => ({ ...l, itemId: l.itemId !== undefined ? (ctx.itemIds.get(l.itemId) ?? l.itemId) : undefined })),
      convertedFromId: undefined,
    })
    await mergeTable(db.invoices as Table<Invoice, number>, 'invoices', keys.invoice, data.invoices ?? [], ctx, localWins, {
      remap: remapInvoice,
      idMap: ctx.invoiceIds,
    })

    const remapPayment = (p: Payment): Payment => ({
      ...p,
      partyId: p.partyId !== undefined ? (ctx.partyIds.get(p.partyId) ?? p.partyId) : undefined,
      invoiceId: p.invoiceId !== undefined ? (ctx.invoiceIds.get(p.invoiceId) ?? p.invoiceId) : undefined,
    })
    await mergeTable(db.payments as Table<Payment, number>, 'payments', keys.payment, data.payments ?? [], ctx, localWins, { remap: remapPayment })
    await mergeTable(db.expenses as Table<Expense, number>, 'expenses', keys.expense, data.expenses ?? [], ctx, localWins)

    /* ---------------- business ---------------- */
    const localBusiness = await db.business.toCollection().first()
    const remoteBusiness = (data.business ?? [])[0] as Business | undefined
    if (!localBusiness && remoteBusiness) {
      const payload = { ...remoteBusiness }
      delete payload.id
      await db.business.add(payload)
      bump(ctx.report.added, 'business')
    } else if (localBusiness && remoteBusiness && !localWins && keys.version(remoteBusiness) > keys.version(localBusiness)) {
      await db.business.put({ ...remoteBusiness, id: localBusiness.id })
      bump(ctx.report.updated, 'business')
    }

    /* ---------------- doc settings (number series) ---------------- */
    const localSettings = await db.docSettings.toArray()
    const settingByType = new Map(localSettings.map((s) => [s.docType, s]))
    for (const remote of data.docSettings ?? []) {
      const local = settingByType.get(remote.docType)
      if (!local) {
        await db.docSettings.add({ ...remote, id: undefined } as DocSetting)
        bump(ctx.report.added, 'docSettings')
      } else {
        // Series kabhi peeche nahi jaani chahiye — dono me se bada counter rakho
        const nextNumber = Math.max(local.nextNumber, remote.nextNumber)
        const prefix = localWins ? local.prefix : remote.prefix || local.prefix
        if (nextNumber !== local.nextNumber || prefix !== local.prefix) {
          await db.docSettings.put({ ...local, nextNumber, prefix })
          bump(ctx.report.updated, 'docSettings')
        } else bump(ctx.report.skipped, 'docSettings')
      }
    }

    /* ---------------- users ---------------- */
    const localUsers = await db.users.toArray()
    const userByName = new Map(localUsers.map((u) => [u.name.trim().toLowerCase(), u]))
    for (const remote of data.users ?? []) {
      if (userByName.has(remote.name.trim().toLowerCase())) {
        bump(ctx.report.skipped, 'users')
        continue
      }
      const payload = { ...remote }
      delete payload.id
      await db.users.add(payload as User)
      bump(ctx.report.added, 'users')
    }

    /* ---------------- app settings (device-local chhod kar) ---------------- */
    const localApp = await db.appSettings.toArray()
    const appByKey = new Map(localApp.map((s) => [s.key, s]))
    for (const remote of data.appSettings ?? []) {
      if (DEVICE_LOCAL.has(remote.key) || appByKey.has(remote.key)) continue
      await db.appSettings.add({ ...remote, id: undefined } as AppSetting)
    }
  })

  return ctx.report
}

const DEVICE_LOCAL = new Set<string>([APP_SETTINGS.cloudConfig, APP_SETTINGS.syncEnabled, APP_SETTINGS.syncAccount, APP_SETTINGS.lastSyncAt, APP_SETTINGS.lastBackupAt])

/* ------------------------------------------------------------------ */
/* Cloud sync orchestration                                            */
/* ------------------------------------------------------------------ */

export interface SyncOutcome {
  companyId: string
  companyName: string
  direction: 'pulled+pushed' | 'pushed' | 'pulled' | 'no-change'
  localRev: number
  remoteRev: number
  merged?: MergeReport
  error?: string
}

/** Ek company sync karo: pehle remote merge (agar naya ho), phir apna snapshot push */
export async function syncCompany(
  cfg: CloudConfig,
  session: CloudSession,
  companyId: string,
  companyName: string,
  opts: { push?: boolean; pull?: boolean } = {},
): Promise<SyncOutcome> {
  const db = dbFor(companyId)
  const fresh = await ensureFresh(cfg, session)
  const localRev = Number((await getSetting(db, 'rev')) ?? '0') || 0

  let remoteRev = 0
  let merged: MergeReport | undefined
  let pulled = false

  if (opts.pull !== false) {
    const remote = await pullSnapshot(cfg, fresh, companyId)
    remoteRev = remote?.rev ?? 0
    const payload = remote?.payload as CompanySnapshot | null
    if (payload && payload.app === 'showroom-manager') {
      // Local khaali hai to remote seedha copy, warna natural-key merge
      const localEmpty = (await db.invoices.count()) === 0 && (await db.items.count()) === 0 && (await db.parties.count()) === 0
      if (localEmpty) {
        await restoreSnapshot(db, payload, { clear: false })
        await setSetting(db, 'rev', String(Math.max(localRev, payload.rev || 0)))
      } else {
        merged = await mergeSnapshot(db, payload)
      }
      pulled = true
    }
  }

  let pushed = false
  if (opts.push !== false) {
    const nextRev = Math.max(localRev, remoteRev) + 1
    await setSetting(db, 'rev', String(nextRev))
    const snapshot = await buildSnapshot(db, companyId, companyName)
    snapshot.rev = nextRev
    await pushSnapshot(cfg, fresh, companyId, snapshot, nextRev)
    pushed = true
    void nextRev
  }

  await setSetting(db, APP_SETTINGS.lastSyncAt, String(nowMs()))
  return {
    companyId,
    companyName,
    direction: pulled && pushed ? 'pulled+pushed' : pushed ? 'pushed' : 'pulled',
    localRev,
    remoteRev,
    merged,
  }
}

/** Saari companies (local + cloud) ek saath sync — "Saari companies sync" button */
export async function syncAllCompanies(cfg: CloudConfig, session: CloudSession): Promise<SyncOutcome[]> {
  const fresh = await ensureFresh(cfg, session)
  const outcomes: SyncOutcome[] = []
  const localList = [...listCompanies()]

  // Cloud par jo company hai par is phone par nahi → bana do
  try {
    const remoteIds = await listRemoteCompanies(cfg, fresh)
    for (const id of remoteIds) {
      if (!localList.some((c) => c.id === id)) {
        const meta = createCompany(`Cloud company ${id.slice(-4)}`)
        // createCompany naya id deta hai; yahan cloud id se mapping chahiye — isliye
        // turant registry theek karo (company id hi cloud document id hai)
        const list = listCompanies().map((c) => (c.id === meta.id ? { ...c, id, name: meta.name } : c))
        saveCompanies(list)
        void companyDbName(id)
        const outcome = await syncCompany(cfg, fresh, id, meta.name, { push: false })
        outcomes.push(outcome)
      }
    }
  } catch (e) {
    outcomes.push({ companyId: '-', companyName: 'cloud list', direction: 'no-change', localRev: 0, remoteRev: 0, error: (e as Error).message })
  }

  for (const company of listCompanies()) {
    try {
      outcomes.push(await syncCompany(cfg, fresh, company.id, company.name))
    } catch (e) {
      outcomes.push({ companyId: company.id, companyName: company.name, direction: 'no-change', localRev: 0, remoteRev: 0, error: (e as Error).message })
    }
  }
  return outcomes
}
