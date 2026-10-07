/** Payments In / Out — roz ka cash register: bill ke against ya on-account (advance) */
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Badge, Button, Card, Chips, ConfirmDialog, EmptyState, Field, Input, Modal, SearchInput, Select, StatTile, useToast } from '../components/ui'
import { PAY_MODES, PAY_MODE_LABEL } from '../lib/db'
import { inr, inrShort, today } from '../lib/format'
import { addPayment, deletePayment, emptyParty, saveParty } from '../lib/repo'
import { PaymentRegister } from '../components/PaymentRegister'
import { PeriodPicker, rangeFor, type PeriodKey } from '../components/PeriodPicker'
import { r2 } from '../lib/calc'
import type { Invoice, Party, PayKind, PayMode, Payment } from '../lib/types'

export function Payments() {
  const { db, params, go } = useApp()
  const { toast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Payment | null>(null)
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [range, setRange] = useState(() => rangeFor('month'))
  const [query, setQuery] = useState('')
  const [modeFilter, setModeFilter] = useState<'all' | PayMode>('all')

  // party se aaye (Khata screen ke "Payment entry" button se)
  useEffect(() => {
    if (params.partyId) setShowForm(true)
  }, [params.partyId])

  const payments = (useLiveQuery(() => db.payments.orderBy('date').reverse().toArray(), [db]) ?? []) as Payment[]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return payments
      .filter((p) => p.date >= range.from && p.date <= range.to)
      .filter((p) => (modeFilter === 'all' ? true : p.mode === modeFilter))
      .filter((p) => (!q ? true : (p.partyName ?? '').toLowerCase().includes(q) || (p.invoiceNumber ?? '').toLowerCase().includes(q) || (p.ref ?? '').toLowerCase().includes(q)))
  }, [payments, range, query, modeFilter])

  const totals = useMemo(() => {
    let inAmt = 0
    let outAmt = 0
    const byMode = new Map<string, { inAmt: number; outAmt: number }>()
    for (const p of filtered) {
      const row = byMode.get(p.mode) ?? { inAmt: 0, outAmt: 0 }
      if (p.kind === 'in') {
        inAmt += p.amount
        row.inAmt += p.amount
      } else {
        outAmt += p.amount
        row.outAmt += p.amount
      }
      byMode.set(p.mode, row)
    }
    return { inAmt: r2(inAmt), outAmt: r2(outAmt), net: r2(inAmt - outAmt), byMode }
  }, [filtered])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Andar aaya" value={inrShort(totals.inAmt)} tone="green" />
        <StatTile label="Bahar gaya" value={inrShort(totals.outAmt)} tone="red" />
        <StatTile label="Net cash" value={inrShort(totals.net)} tone={totals.net >= 0 ? 'green' : 'red'} />
      </div>

      <Button size="lg" className="w-full" onClick={() => setShowForm(true)}>
        ＋ Nayi payment entry (in / out)
      </Button>

      <PeriodPicker
        value={period}
        custom={range}
        onChange={(key, r) => {
          setPeriod(key)
          setRange(r)
        }}
      />

      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Party, bill number, UPI ref…" />
        </div>
        <Select value={modeFilter} onChange={(e) => setModeFilter(e.target.value as 'all' | PayMode)} className="w-28">
          <option value="all">Sab mode</option>
          {PAY_MODES.map((m) => (
            <option key={m} value={m}>
              {PAY_MODE_LABEL[m]}
            </option>
          ))}
        </Select>
      </div>

      {totals.byMode.size > 0 && (
        <Card className="py-3">
          <div className="mb-2 text-xs font-bold text-slate-600">Mode-wise total</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...totals.byMode.entries()].map(([mode, t]) => (
              <div key={mode} className="rounded-xl bg-slate-50 px-2 py-1.5 text-[11px]">
                <div className="font-bold text-slate-700">{PAY_MODE_LABEL[mode] ?? mode}</div>
                <div className="text-emerald-700">in {inr(t.inAmt)}</div>
                <div className="text-rose-600">out {inr(t.outAmt)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="💸"
          title="Is period me koi payment nahi"
          hint="Bill ke against ya on-account (advance) entry kar sakte hain"
          action={
            <Button className="mt-2" onClick={() => setShowForm(true)}>
              ＋ Payment entry
            </Button>
          }
        />
      ) : (
        <PaymentRegister
          payments={filtered}
          onOpenInvoice={(invoiceId) => go('invoice', { invoiceId })}
          onDelete={(p) => setConfirmDelete(p)}
        />
      )}

      <PaymentForm open={showForm} onClose={() => setShowForm(false)} />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Payment delete karein?"
        message="Payment hath jayegi aur us bill ka 'paid' amount dobara calculate hoga."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete?.id) {
            await deletePayment(db, confirmDelete.id)
            toast('Payment delete ho gayi', 'success')
          }
          setConfirmDelete(null)
        }}
      />
    </div>
  )
}

/** Payment entry form — party + bill ya on-account */
function PaymentForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, params } = useApp()
  const { toast } = useToast()
  const [kind, setKind] = useState<PayKind>((params.kind as PayKind) ?? 'in')
  const [date, setDate] = useState(today())
  const [party, setParty] = useState<Party | undefined>()
  const [partyQuery, setPartyQuery] = useState('')
  const [invoiceId, setInvoiceId] = useState<number | ''>('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PayMode>('cash')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const parties = (useLiveQuery(() => db.parties.orderBy('name').toArray(), [db]) ?? []) as Party[]
  const openBills = (useLiveQuery(async () => {
    if (!party?.id) return [] as Invoice[]
    const list = await db.invoices.where('partyId').equals(party.id).toArray()
    const want: string[] = kind === 'out' ? ['purchase_bill'] : ['tax_invoice', 'bill_of_supply']
    return list.filter((i) => !i.cancelled && want.includes(i.docType) && r2(i.grandTotal - i.paid) > 0.009).sort((a, b) => a.date.localeCompare(b.date))
  }, [db, party?.id, kind]) ?? []) as Invoice[]

  // params.partyId se party prefill
  useEffect(() => {
    if (!open) return
    setKind((params.kind as PayKind) ?? 'in')
    if (params.partyId) {
      void db.parties.get(params.partyId).then((p) => setParty(p))
    } else {
      setParty(undefined)
      setInvoiceId('')
      setAmount('')
      setPartyQuery('')
      setRef('')
      setNote('')
    }
  }, [open, params.partyId, params.kind, db])

  const selectedBill = openBills.find((b) => b.id === invoiceId)
  const dueOfBill = selectedBill ? r2(selectedBill.grandTotal - selectedBill.paid) : 0

  const partyMatches = useMemo(() => {
    const q = partyQuery.trim().toLowerCase()
    const list = parties.filter((p) => (kind === 'out' ? p.type !== 'customer' : p.type !== 'supplier'))
    return q ? list.filter((p) => p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q)).slice(0, 8) : []
  }, [parties, partyQuery, kind])

  const save = async () => {
    setSaving(true)
    try {
      const amt = Number(amount) || (selectedBill ? dueOfBill : 0)
      if (!(amt > 0)) throw new Error('Amount likhein')
      await addPayment(db, {
        kind,
        date,
        partyId: party?.id,
        partyName: party?.name,
        invoiceId: selectedBill?.id,
        invoiceNumber: selectedBill?.number,
        amount: amt,
        mode,
        ref: ref.trim() || undefined,
        note: note.trim() || undefined,
      })
      toast(selectedBill ? `${selectedBill.number} par payment ho gaya ✅` : 'On-account payment ho gaya ✅', 'success')
      onClose()
      setAmount('')
      setNote('')
      setRef('')
      setInvoiceId('')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Payment entry"
      footer={
        <Button className="w-full" onClick={() => void save()} disabled={saving}>
          {saving ? 'Save ho raha hai…' : 'Payment save karein'}
        </Button>
      }
    >
      <div className="space-y-3">
        <Chips
          value={kind}
          onChange={(k) => {
            setKind(k)
            setInvoiceId('')
          }}
          options={[
            { value: 'in' as const, label: '⬇ Payment In (mila)' },
            { value: 'out' as const, label: '⬆ Payment Out (diya)' },
          ]}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value as PayMode)}>
              {PAY_MODES.map((m) => (
                <option key={m} value={m}>
                  {PAY_MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={kind === 'in' ? 'Kis se mila (customer)' : 'Kisko diya (supplier)'}>
          {party ? (
            <div className="flex items-center justify-between rounded-xl border border-slate-300 px-3 py-2.5">
              <span className="text-sm font-semibold text-slate-800">{party.name}</span>
              <button
                type="button"
                className="text-xs text-rose-600"
                onClick={() => {
                  setParty(undefined)
                  setInvoiceId('')
                }}
              >
                badlein ✕
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <SearchInput value={partyQuery} onChange={setPartyQuery} placeholder="Naam ya number se dhundein" />
              {partyMatches.length > 0 && (
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {partyMatches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm"
                      onClick={() => {
                        setParty(p)
                        setPartyQuery('')
                      }}
                    >
                      <span>{p.name}</span>
                      <span className="text-[11px] text-slate-500">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="text-xs font-semibold text-indigo-700"
                onClick={async () => {
                  const name = partyQuery.trim()
                  if (!name) return
                  const id = await saveParty(db, { ...emptyParty(kind === 'out' ? 'supplier' : 'customer'), name })
                  const created = await db.parties.get(id)
                  if (created) setParty(created)
                  setPartyQuery('')
                }}
              >
                ＋ "{partyQuery.trim() || 'Nayi party'}" bana dein
              </button>
            </div>
          )}
        </Field>

        {party && (
          <Field label="Bill ke against (optional)" hint="Khaali chhodein to on-account / advance me jayegi">
            <Select value={String(invoiceId)} onChange={(e) => setInvoiceId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">On account (advance / purana hisab)</option>
              {openBills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.number} · {b.date} · baaki {inr(r2(b.grandTotal - b.paid))}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Amount" hint={selectedBill ? `${selectedBill.number} ka baaki: ${inr(dueOfBill)}` : undefined}>
          <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={selectedBill ? String(dueOfBill) : '0'} />
        </Field>

        {selectedBill && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAmount(String(dueOfBill))}>
              Poora baaki ({inr(dueOfBill)})
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAmount(String(r2(dueOfBill / 2)))}>
              Aadha
            </Button>
          </div>
        )}

        <Field label="Ref / Cheque no.">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UPI ref / cheque no." />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          {selectedBill ? (
            <>
              Ye payment <Badge tone="indigo">{selectedBill.number}</Badge> ke paid amount me judegi aur status update ho jayega.
            </>
          ) : (
            <>On-account payment party ke khata (aging) me sabse purane bill par FIFO adjust hoti hai.</>
          )}
        </div>
      </div>
    </Modal>
  )
}
