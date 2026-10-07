/**
 * Natural keys — ek hi row ko do devices par pehchanne ke liye.
 *
 * Kyun zaroori hai?
 *  • Sync merge inhi keys par match karta hai (item code, bill number, party naam…).
 *  • Tombstone (delete marker) bhi natural key par likha jata hai.
 *    Agar hum sirf local `id` par likhte, to doosre phone ka id match ho kar
 *    kisi aur ka data delete ho sakta tha — yani "delete propagation" bug.
 */
import type { Expense, Invoice, Item, Party, Payment } from './types'

export const keys = {
  item: (i: Item) => `item:${(i.code || i.barcode || i.name).trim().toLowerCase()}`,
  party: (p: Party) => `party:${p.name.trim().toLowerCase()}`,
  invoice: (i: Invoice) => `inv:${i.number.trim().toLowerCase()}`,
  payment: (p: Payment) =>
    `pay:${p.date}|${p.amount}|${p.kind}|${p.mode}|${(p.invoiceNumber ?? '').trim().toLowerCase()}|${(p.partyName ?? '').trim().toLowerCase()}`,
  expense: (e: Expense) => `exp:${e.date}|${e.category.trim().toLowerCase()}|${e.amount}|${e.mode}`,

  /** "Naya wala jeetta hai" — updatedAt, warna createdAt, warna fallback */
  version: (v: { createdAt?: number; updatedAt?: number }, fallback = 0) => v.updatedAt ?? v.createdAt ?? fallback,

  /** Tombstone key banane ke liye prefix */
  tomb: (kind: 'item' | 'party' | 'invoice' | 'payment' | 'expense', naturalKey: string) => `${kind}|${naturalKey}`,
}
