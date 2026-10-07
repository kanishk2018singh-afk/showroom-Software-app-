/** Bills list — filter (doc type, status, period) + search + quick actions */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Badge, Button, Card, Chips, EmptyState, SearchInput, Select, StatTile } from '../components/ui'
import { ALL_DOC_TYPES, DOC_LABEL, DOC_SHORT } from '../lib/db'
import { inr, inrShort } from '../lib/format'
import { PeriodPicker, rangeFor, type PeriodKey } from '../components/PeriodPicker'
import { r2 } from '../lib/calc'
import type { DocType, Invoice } from '../lib/types'

type Filter = 'all' | DocType | 'due' | 'paid' | 'cancelled'

export function Invoices() {
  const { db, go } = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [range, setRange] = useState(() => rangeFor('month'))
  const [sort, setSort] = useState<'new' | 'amount'>('new')

  const invoices = (useLiveQuery(() => db.invoices.orderBy('date').reverse().toArray(), [db]) ?? []) as Invoice[]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = invoices.filter((i) => i.date >= range.from && i.date <= range.to)
    if (filter === 'due') list = list.filter((i) => !i.cancelled && i.grandTotal - i.paid > 0.009 && ['tax_invoice', 'bill_of_supply', 'purchase_bill'].includes(i.docType))
    else if (filter === 'paid') list = list.filter((i) => !i.cancelled && i.grandTotal - i.paid <= 0.009)
    else if (filter === 'cancelled') list = list.filter((i) => i.cancelled)
    else if (filter !== 'all') list = list.filter((i) => i.docType === filter)
    if (q) list = list.filter((i) => i.number.toLowerCase().includes(q) || i.partyName.toLowerCase().includes(q) || (i.partyPhone ?? '').includes(q))
    if (sort === 'amount') list = [...list].sort((a, b) => b.grandTotal - a.grandTotal)
    else list = [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0))
    return list
  }, [invoices, filter, query, range, sort])

  const totals = useMemo(() => {
    let sale = 0
    let due = 0
    for (const i of filtered) {
      if (i.cancelled) continue
      const sign = i.docType === 'credit_note' ? -1 : 1
      if (sign > 0 && i.docType !== 'purchase_bill') sale += sign * i.grandTotal
      if (['tax_invoice', 'bill_of_supply', 'purchase_bill'].includes(i.docType)) due += i.grandTotal - i.paid
    }
    return { sale: r2(sale), due: r2(due), count: filtered.length }
  }, [filtered])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Bills" value={String(totals.count)} sub="is period me" />
        <StatTile label="Sale" value={inrShort(totals.sale)} tone="indigo" />
        <StatTile label="Baaki" value={inrShort(totals.due)} tone={totals.due > 0 ? 'amber' : 'green'} />
      </div>

      <PeriodPicker
        value={period}
        custom={range}
        onChange={(key, r) => {
          setPeriod(key)
          setRange(r)
        }}
      />

      <SearchInput value={query} onChange={setQuery} placeholder="Bill number ya party ka naam" />

      <Chips
        size="sm"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all' as const, label: 'Sab' },
          { value: 'due' as const, label: 'Baaki 💸' },
          { value: 'paid' as const, label: 'Paid ✅' },
          ...ALL_DOC_TYPES.map((d) => ({ value: d, label: DOC_SHORT[d] })),
          { value: 'cancelled' as const, label: 'Cancelled' },
        ]}
      />

      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-slate-500">{filtered.length} bills</span>
        <Select value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'amount')} className="w-auto py-1.5 text-xs">
          <option value="new">Naye pehle</option>
          <option value="amount">Bada amount pehle</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="Is period me koi bill nahi"
          hint="Date range badal kar dekhein ya naya bill banayein"
          action={
            <Button className="mt-2" onClick={() => go('billing', { docType: 'tax_invoice' })}>
              ＋ Naya bill
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => {
            const due = r2(inv.grandTotal - inv.paid)
            return (
              <Card key={inv.id} onClick={() => go('invoice', { invoiceId: inv.id })} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-slate-800">{inv.partyName || 'Cash Sale'}</span>
                      {inv.cancelled ? (
                        <Badge tone="red">Cancelled</Badge>
                      ) : due <= 0.009 && ['tax_invoice', 'bill_of_supply', 'purchase_bill'].includes(inv.docType) ? (
                        <Badge tone="green">Paid</Badge>
                      ) : inv.paid > 0.009 ? (
                        <Badge tone="amber">Aadha paid</Badge>
                      ) : ['tax_invoice', 'bill_of_supply', 'purchase_bill'].includes(inv.docType) ? (
                        <Badge tone="red">Udhaar</Badge>
                      ) : (
                        <Badge tone="indigo">{DOC_SHORT[inv.docType]}</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {inv.number} · {inv.date} · {inv.lines.length} item
                      {inv.mode ? ` · ${inv.mode}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-extrabold text-slate-900">{inr(inv.grandTotal)}</div>
                    {due > 0.009 && !inv.cancelled && ['tax_invoice', 'bill_of_supply', 'purchase_bill'].includes(inv.docType) && (
                      <div className="text-[11px] text-rose-600">baaki {inr(due)}</div>
                    )}
                    {inv.docType === 'purchase_bill' && <div className="text-[10px] text-slate-400">purchase</div>}
                    {inv.docType === 'estimate' && <div className="text-[10px] text-slate-400">stock nahi kata</div>}
                  </div>
                </div>
                {inv.convertedToId && <div className="mt-1 text-[10px] text-indigo-600">→ invoice ban chuka hai</div>}
                {DOC_LABEL[inv.docType] === 'Tax Invoice' && inv.igst > 0 && <div className="mt-1 text-[10px] text-slate-400">IGST bill</div>}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
