/** Khata / Parties — customer + supplier list, balance, ledger, WhatsApp reminder */
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Button, Card, Chips, ConfirmDialog, EmptyState, Field, Input, Modal, SearchInput, Select, StatTile, useToast } from '../components/ui'
import { buildLedger, computeDue, deleteParty, emptyParty, saveParty } from '../lib/repo'
import { fmtDate, inr, inrShort, waLink } from '../lib/format'
import { reminderText } from '../lib/doc'
import { r2 } from '../lib/calc'
import type { Party } from '../lib/types'

type Tab = 'customer' | 'supplier'

export function Parties() {
  const { db, business, go } = useApp()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('customer')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Party | null>(null)
  const [detail, setDetail] = useState<Party | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Party | null>(null)

  const data = useLiveQuery(async () => {
    const [parties, invoices, payments] = await Promise.all([db.parties.orderBy('name').toArray(), db.invoices.toArray(), db.payments.toArray()])
    return {
      parties,
      invoices,
      payments,
      dueOf: (p: Party) => computeDue(p, invoices, payments),
    }
  }, [db])

  const list = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.parties
      .filter((p) => (tab === 'customer' ? p.type !== 'supplier' : p.type === 'supplier' || p.type === 'both'))
      .filter((p) => (!q ? true : p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q)))
      .sort((a, b) => Math.abs(data.dueOf(b).due) - Math.abs(data.dueOf(a).due) || a.name.localeCompare(b.name))
  }, [data, query, tab])

  const totals = useMemo(() => {
    if (!data) return { due: 0, advance: 0 }
    let due = 0
    let advance = 0
    for (const p of list) {
      const d = data.dueOf(p).due
      if (d > 0) due += d
      else advance += -d
    }
    return { due: r2(due), advance: r2(advance) }
  }, [list, data])

  return (
    <div className="space-y-3">
      <Chips
        value={tab}
        onChange={setTab}
        options={[
          { value: 'customer' as const, label: '👥 Customer (lena hai)' },
          { value: 'supplier' as const, label: '🏭 Supplier (dena hai)' },
        ]}
      />

      <div className="grid grid-cols-2 gap-2">
        <StatTile label={tab === 'customer' ? 'Kul lena hai' : 'Kul dena hai'} value={inrShort(totals.due)} tone={totals.due > 0 ? 'amber' : 'green'} />
        <StatTile label="Advance jama / diya" value={inrShort(totals.advance)} tone="indigo" />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Naam ya mobile number" />
        </div>
        <Button onClick={() => setEditing(emptyParty(tab === 'supplier' ? 'supplier' : 'customer'))}>＋ Naya</Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="👥"
          title={tab === 'customer' ? 'Koi customer nahi' : 'Koi supplier nahi'}
          hint="Party banayein — bill/khata uske naam par jud jayega"
          action={
            <Button className="mt-2" onClick={() => setEditing(emptyParty(tab === 'supplier' ? 'supplier' : 'customer'))}>
              ＋ Party banayein
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {list.map((p) => {
            const due = data?.dueOf(p).due ?? 0
            return (
              <Card key={p.id} onClick={() => setDetail(p)} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-800">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-800">{p.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.phone || 'no number'}
                        {p.gstin ? ` · ${p.gstin}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-sm font-extrabold ${due > 0.009 ? 'text-rose-600' : due < -0.009 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {inr(Math.abs(due))}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {due > 0.009 ? (tab === 'customer' ? 'lena hai' : 'dena hai') : due < -0.009 ? 'advance' : 'hisab saaf'}
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <PartyForm
        party={editing}
        onClose={() => setEditing(null)}
        onSave={async (p) => {
          try {
            await saveParty(db, p)
            toast(p.id ? 'Party update ho gayi' : 'Party ban gayi', 'success')
            setEditing(null)
          } catch (e) {
            toast((e as Error).message, 'error')
          }
        }}
        onDelete={
          editing?.id
            ? () => {
                setConfirmDelete(editing)
              }
            : undefined
        }
      />

      {detail && (
        <LedgerModal
          party={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail)
            setDetail(null)
          }}
          onPayment={() => {
            go('payments', { partyId: detail.id, kind: tab === 'supplier' ? 'out' : 'in' })
            setDetail(null)
          }}
          onNewBill={() => {
            go('billing', { docType: tab === 'supplier' ? 'purchase_bill' : 'tax_invoice' })
            setDetail(null)
          }}
          onReminder={(due) => {
            const text = reminderText(
              business,
              detail,
              { partyId: detail.id as number, billed: due.billed, paid: due.paid, due: due.due, invoices: due.invoices },
              { isSupplier: tab === 'supplier' },
            )
            window.open(waLink(detail.phone, text), '_blank')
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Party delete karein?"
        message="Party list se hat jayegi. Uske purane bills record me rahenge, lekin khata balance se nikal jayengi."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete?.id) {
            await deleteParty(db, confirmDelete.id)
            toast('Party delete ho gayi', 'success')
          }
          setConfirmDelete(null)
          setEditing(null)
        }}
      />
    </div>
  )
}

function PartyForm({
  party,
  onClose,
  onSave,
  onDelete,
}: {
  party: Party | null
  onClose: () => void
  onSave: (p: Party) => void | Promise<void>
  onDelete?: () => void
}) {
  const [form, setForm] = useState<Party | null>(party)

  useEffect(() => {
    setForm(party)
  }, [party])

  if (!form) return null
  const set = <K extends keyof Party>(key: K, value: Party[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))

  return (
    <Modal
      open={!!form}
      onClose={onClose}
      title={form.id ? 'Party edit' : 'Nayi party'}
      footer={
        <div className="flex gap-2">
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              🗑
            </Button>
          )}
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => void onSave(form)}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Naam" required>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ramesh Kumar / Sharma Traders" />
          </Field>
        </div>
        <Field label="Mobile">
          <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Type">
          <Select value={form.type} onChange={(e) => set('type', e.target.value as Party['type'])}>
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
            <option value="both">Dono (customer + supplier)</option>
          </Select>
        </Field>
        <Field label="GSTIN">
          <Input value={form.gstin ?? ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} />
        </Field>
        <Field label="State">
          <Input value={form.state ?? ''} onChange={(e) => set('state', e.target.value)} placeholder="Uttar Pradesh" />
        </Field>
        <div className="col-span-2">
          <Field label="Address">
            <Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Opening balance (purana bakaya)" hint="Customer: +ve = lena hai · Supplier: +ve = dena hai">
            <Input type="number" inputMode="decimal" value={form.openingBalance || ''} onChange={(e) => set('openingBalance', Number(e.target.value) || 0)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function LedgerModal({
  party,
  onClose,
  onEdit,
  onPayment,
  onNewBill,
  onReminder,
}: {
  party: Party
  onClose: () => void
  onEdit: () => void
  onPayment: () => void
  onNewBill: () => void
  onReminder: (due: { billed: number; paid: number; due: number; invoices: number }) => void
}) {
  const { db } = useApp()
  const ledger = useLiveQuery(async () => {
    const [invoices, payments] = await Promise.all([db.invoices.toArray(), db.payments.toArray()])
    return buildLedger(party, invoices, payments)
  }, [db, party.id])

  return (
    <Modal open onClose={onClose} title={party.name} wide>
      {!ledger ? (
        <div className="py-6 text-center text-sm text-slate-500">Ledger khul raha hai…</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 py-2">
              <div className="text-[10px] uppercase text-slate-500">Total business</div>
              <div className="text-sm font-bold">{inr(ledger.due.billed)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 py-2">
              <div className="text-[10px] uppercase text-slate-500">Jama</div>
              <div className="text-sm font-bold">{inr(ledger.due.paid)}</div>
            </div>
            <div className={`rounded-xl py-2 ${ledger.due.due > 0.009 ? 'bg-rose-50' : 'bg-emerald-50'}`}>
              <div className="text-[10px] uppercase text-slate-500">{ledger.due.due >= 0 ? 'Baaki' : 'Advance'}</div>
              <div className="text-sm font-bold">{inr(Math.abs(ledger.due.due))}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onNewBill}>
              🧾 {party.type === 'supplier' ? 'Purchase bill' : 'Naya bill'}
            </Button>
            <Button size="sm" variant="warning" onClick={onPayment}>
              💰 Payment entry
            </Button>
            <Button size="sm" variant="success" onClick={() => onReminder({ billed: ledger.due.billed, paid: ledger.due.paid, due: ledger.due.due, invoices: ledger.due.invoices })}>
              💬 Reminder
            </Button>
            <Button size="sm" variant="secondary" onClick={onEdit}>
              ✏️ Edit
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-2 py-1.5 text-left">Date</th>
                  <th className="px-2 py-1.5 text-left">Detail</th>
                  <th className="px-2 py-1.5 text-right">Debit</th>
                  <th className="px-2 py-1.5 text-right">Credit</th>
                  <th className="px-2 py-1.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r, i) => (
                  <tr key={`${r.date}-${r.label}-${i}`} className={i % 2 ? 'bg-slate-50' : ''}>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.date ? fmtDate(r.date) : '—'}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-semibold text-slate-700">{r.label}</div>
                      <div className="text-[10px] text-slate-500">{r.ref}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{r.debit ? inr(r.debit) : ''}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{r.credit ? inr(r.credit) : ''}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{inr(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">Balance +ve = lena hai / dena hai (party type ke hisaab se), −ve = advance.</p>
        </div>
      )}
    </Modal>
  )
}
