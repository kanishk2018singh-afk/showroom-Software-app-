/** Home — ek nazar me dukaan ka haal + quick actions */
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Badge, Card, EmptyState, SectionTitle, StatTile } from '../components/ui'
import { DOC_SHORT } from '../lib/db'
import { fyStart, inr, inrShort, monthLabel, today } from '../lib/format'
import { r2 } from '../lib/calc'
import { computeDue } from '../lib/repo'
import { isSaleDoc } from '../lib/calc'

export function Home() {
  const { db, business, go } = useApp()

  const data = useLiveQuery(async () => {
    const [invoices, payments, parties, items] = await Promise.all([
      db.invoices.toArray(),
      db.payments.toArray(),
      db.parties.toArray(),
      db.items.toArray(),
    ])

    const t = today()
    const monthStart = `${t.slice(0, 7)}-01`
    const fyFrom = fyStart()

    let todaySale = 0
    let monthSale = 0
    let fySale = 0
    let todayBills = 0
    for (const inv of invoices) {
      if (inv.cancelled || !isSaleDoc(inv.docType)) continue
      const sign = inv.docType === 'credit_note' ? -1 : 1
      const amount = sign * inv.grandTotal
      if (inv.date === t) {
        todaySale += amount
        if (sign > 0) todayBills += 1
      }
      if (inv.date >= monthStart) monthSale += amount
      if (inv.date >= fyFrom) fySale += amount
    }

    let receivable = 0
    let payable = 0
    for (const p of parties) {
      const due = computeDue(p, invoices, payments).due
      if (p.type === 'supplier') payable += Math.max(0, due)
      else receivable += Math.max(0, due)
    }
    if (payments.length && !parties.length) {
      for (const p of payments) if (!p.partyId) receivable += p.kind === 'in' ? p.amount : -p.amount
    }

    const lowStock = items.filter((i) => i.stock <= (i.lowStockAlert ?? 0))
    const recent = [...invoices].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6)

    return {
      todaySale: r2(todaySale),
      monthSale: r2(monthSale),
      fySale: r2(fySale),
      todayBills,
      receivable: r2(Math.max(0, receivable)),
      payable: r2(payable),
      lowStock,
      recent,
      stockValue: r2(items.reduce((s, i) => s + i.stock * i.purchaseRate, 0)),
    }
  }, [db])

  const quick = useMemo(
    () => [
      { icon: '🧾', label: 'Naya Bill', action: () => go('billing', { docType: 'tax_invoice' }) },
      { icon: '📝', label: 'Estimate', action: () => go('billing', { docType: 'estimate' }) },
      { icon: '📦', label: 'Items', action: () => go('items') },
      { icon: '👥', label: 'Khata', action: () => go('parties') },
      { icon: '💸', label: 'Payment', action: () => go('payments') },
      { icon: '🧮', label: 'Kharcha', action: () => go('expenses') },
      { icon: '📊', label: 'Reports', action: () => go('reports') },
      { icon: '☰', label: 'Sab', action: () => go('more') },
    ],
    [go],
  )

  if (!data) return <div className="py-10 text-center text-sm text-slate-500">Hisab lag raha hai…</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Aaj ki sale" value={inrShort(data.todaySale)} sub={`${data.todayBills} bill`} tone="indigo" onClick={() => go('reports')} />
        <StatTile label={`${monthLabel(today())} sale`} value={inrShort(data.monthSale)} sub={`FY: ${inrShort(data.fySale)}`} onClick={() => go('reports')} />
        <StatTile
          label="Lena hai (udhaar)"
          value={inrShort(data.receivable)}
          sub="customer se"
          tone={data.receivable > 0 ? 'amber' : 'green'}
          onClick={() => go('reports', { tab: 'aging' })}
        />
        <StatTile label="Dena hai (supplier)" value={inrShort(data.payable)} sub="payable" tone="red" onClick={() => go('payments', { kind: 'out' })} />
      </div>

      <Card>
        <SectionTitle right={<span className="text-[11px] text-slate-500">Stock value {inrShort(data.stockValue)}</span>}>⚡ Jaldi se</SectionTitle>
        <div className="grid grid-cols-4 gap-2">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={q.action}
              className="flex flex-col items-center gap-1 rounded-2xl bg-slate-50 px-1 py-3 text-[11px] font-semibold text-slate-700 active:bg-slate-100"
            >
              <span className="text-xl">{q.icon}</span>
              {q.label}
            </button>
          ))}
        </div>
      </Card>

      {data.lowStock.length > 0 && (
        <Card onClick={() => go('items', { tab: 'low' })} className="border-l-4 border-amber-400">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-800">⚠ {data.lowStock.length} item low stock me</div>
              <div className="text-[11px] text-slate-500">{data.lowStock.slice(0, 3).map((i) => i.name).join(', ')}{data.lowStock.length > 3 ? ' …' : ''}</div>
            </div>
            <span className="text-slate-400">›</span>
          </div>
        </Card>
      )}

      <div>
        <SectionTitle right={<button className="text-xs font-semibold text-indigo-700" onClick={() => go('invoices')}>Sab dekhein</button>}>
          🕒 Recent bills
        </SectionTitle>
        {data.recent.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="Abhi koi bill nahi bana"
            hint="Pehla bill banane ke liye 'Naya Bill' dabayein"
            action={
              <button onClick={() => go('billing', { docType: 'tax_invoice' })} className="mt-2 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white">
                Bill banayein
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            {data.recent.map((inv) => (
              <Card key={inv.id} onClick={() => go('invoice', { invoiceId: inv.id })} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-800">{inv.partyName || 'Cash Sale'}</span>
                      {inv.cancelled ? (
                        <Badge tone="red">Cancel</Badge>
                      ) : inv.status === 'paid' ? (
                        <Badge tone="green">Paid</Badge>
                      ) : inv.status === 'partial' ? (
                        <Badge tone="amber">Aadha</Badge>
                      ) : (
                        <Badge tone="red">Baaki</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {inv.number} · {DOC_SHORT[inv.docType]} · {inv.date}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-extrabold text-slate-900">{inr(inv.grandTotal)}</div>
                    {inv.grandTotal - inv.paid > 0.009 && !inv.cancelled && (
                      <div className="text-[11px] text-rose-600">baaki {inr(inv.grandTotal - inv.paid)}</div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {business.name && (
        <p className="pt-2 text-center text-[11px] text-slate-400">
          {business.name} · Data isi device me safe hai (Settings → Backup se JSON nikaal lein)
        </p>
      )}
    </div>
  )
}
