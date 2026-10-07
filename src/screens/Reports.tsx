/** Reports — sale, GST, profit, aging, stock, day book (sab CSV export ke saath) */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Button, Card, Chips, EmptyState, Input, SectionTitle, StatTile, useToast } from '../components/ui'
import { BarChart, Donut, HBars } from '../components/Charts'
import { PeriodPicker, rangeFor, type PeriodKey } from '../components/PeriodPicker'
import { inr, inrShort, today } from '../lib/format'
import {
  agingReport, agingTable, dailySeries, dayBook, dayBookTable, gstSummary, gstTable, hsnSummary,
  itemWiseReport, lowStockItems, monthlySeries, partyWiseReport, paymentModeSummary, paymentRegister,
  salesRegister, stockValue, summary, topItems, topParties,
} from '../lib/reports'
import { r2 } from '../lib/calc'
import { tableToCsv } from '../lib/csv'
import { downloadBlob } from '../lib/util'
import { PAY_MODE_LABEL } from '../lib/db'
import type { DateRange } from '../lib/types'

type Tab = 'summary' | 'gst' | 'aging' | 'stock' | 'daybook'
type AgingSide = 'customer' | 'supplier'

export function Reports() {
  const { db, business, params } = useApp()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>((params.tab as Tab) ?? 'summary')
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [range, setRange] = useState<DateRange>(() => rangeFor('month'))
  const [agingSide, setAgingSide] = useState<AgingSide>('customer')
  const [dayDate, setDayDate] = useState(today())

  const data = useLiveQuery(async () => {
    const [sum, daily, monthly, items, parties, modes, gst, hsn, stock, low, agingC, agingS, book] = await Promise.all([
      summary(db, range),
      dailySeries(db, range),
      monthlySeries(db),
      topItems(db, range, 10),
      topParties(db, range, 10),
      paymentModeSummary(db, range),
      gstSummary(db, range),
      hsnSummary(db, range),
      stockValue(db),
      lowStockItems(db),
      agingReport(db, 'customer'),
      agingReport(db, 'supplier'),
      dayBook(db, dayDate),
    ])
    return { sum, daily, monthly, items, parties, modes, gst, hsn, stock, low, agingC, agingS, book }
  }, [db, range, dayDate])

  const exportCsv = async (kind: string) => {
    try {
      const table =
        kind === 'sales' ? await salesRegister(db, range)
        : kind === 'items' ? await itemWiseReport(db, range)
        : kind === 'parties' ? await partyWiseReport(db, range)
        : kind === 'gst' ? await gstTable(db, range)
        : kind === 'aging' ? await agingTable(db, agingSide, today())
        : kind === 'daybook' ? await dayBookTable(db, dayDate)
        : await paymentRegister(db, range)
      downloadBlob(`${table.name}-${range.from}-to-${range.to}.csv`, new Blob([tableToCsv(table)], { type: 'text/csv' }))
      toast('CSV download ho gayi', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const aging = agingSide === 'customer' ? data?.agingC : data?.agingS

  return (
    <div className="space-y-3">
      <Chips
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'summary' as const, label: '📈 Sale & Profit' },
          { value: 'gst' as const, label: '🧾 GST / HSN' },
          { value: 'aging' as const, label: '⏳ Udhaar Aging' },
          { value: 'stock' as const, label: '📦 Stock' },
          { value: 'daybook' as const, label: '📅 Day Book' },
        ]}
      />

      {tab !== 'daybook' && tab !== 'aging' && (
        <PeriodPicker
          value={period}
          custom={range}
          onChange={(key, r) => {
            setPeriod(key)
            setRange(r)
          }}
        />
      )}

      {!data ? (
        <div className="py-10 text-center text-sm text-slate-500">Reports ban rahi hain…</div>
      ) : (
        <>
          {/* ---------------- summary ---------------- */}
          {tab === 'summary' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <StatTile label="Net sale" value={inrShort(data.sum.netSale)} sub={`${data.sum.billCount} bills`} tone="indigo" />
                <StatTile label="Taxable value" value={inrShort(data.sum.taxableValue)} />
                <StatTile label="GST collected" value={inrShort(data.sum.gstCollected)} tone="amber" />
                <StatTile label="Discount diya" value={inrShort(data.sum.discount)} />
                <StatTile label="Purchase" value={inrShort(data.sum.purchaseTotal)} tone="red" />
                <StatTile label="Kharcha" value={inrShort(data.sum.expenseTotal)} tone="red" />
                <StatTile label="Gross profit" value={inrShort(data.sum.grossProfit)} tone="green" />
                <StatTile label="Net profit (kamai)" value={inrShort(data.sum.netProfit)} tone={data.sum.netProfit >= 0 ? 'green' : 'red'} sub="sale profit − kharcha" />
                <StatTile label="Average bill" value={inrShort(data.sum.avgBill)} sub={`qty ${data.sum.totalQty}`} />
              </div>

              <Card>
                <SectionTitle right={<Button size="sm" variant="secondary" onClick={() => void exportCsv('sales')}>⬇ CSV</Button>}>Din-wise sale</SectionTitle>
                <BarChart data={data.daily.map((d) => ({ label: d.date.slice(5), value: d.sale, secondary: d.purchase }))} />
                <div className="mt-2 flex gap-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-indigo-500" /> sale</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-amber-300" /> purchase</span>
                </div>
              </Card>

              <Card>
                <SectionTitle>Mahine-wise sale vs purchase</SectionTitle>
                <BarChart data={data.monthly.map((m) => ({ label: m.label, value: m.sale, secondary: m.purchase }))} />
              </Card>

              <Card>
                <SectionTitle>Payment mode se paisa</SectionTitle>
                <Donut
                  data={data.modes.map((m) => ({ label: PAY_MODE_LABEL[m.mode] ?? m.mode, value: m.totalIn }))}
                  centerLabel={inrShort(data.modes.reduce((s, m) => s + m.totalIn, 0))}
                />
              </Card>

              <Card>
                <SectionTitle right={<Button size="sm" variant="secondary" onClick={() => void exportCsv('items')}>⬇ CSV</Button>}>Top items</SectionTitle>
                <HBars data={data.items.map((i) => ({ label: i.name, value: i.amount }))} />
              </Card>

              <Card>
                <SectionTitle right={<Button size="sm" variant="secondary" onClick={() => void exportCsv('parties')}>⬇ CSV</Button>}>Top parties</SectionTitle>
                <HBars data={data.parties.map((p) => ({ label: p.name, value: p.amount }))} tone="green" />
              </Card>
            </div>
          )}

          {/* ---------------- GST ---------------- */}
          {tab === 'gst' && (
            <div className="space-y-3">
              <Card>
                <SectionTitle right={<Button size="sm" variant="secondary" onClick={() => void exportCsv('gst')}>⬇ CSV</Button>}>GST summary (GSTR-1 jaisa)</SectionTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5 text-left">GST</th>
                        <th className="px-2 py-1.5 text-right">Taxable</th>
                        <th className="px-2 py-1.5 text-right">CGST</th>
                        <th className="px-2 py-1.5 text-right">SGST</th>
                        <th className="px-2 py-1.5 text-right">IGST</th>
                        <th className="px-2 py-1.5 text-right">Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.gst.map((g) => (
                        <tr key={g.gstPct}>
                          <td className="px-2 py-1.5 font-semibold">{g.gstPct}%</td>
                          <td className="px-2 py-1.5 text-right">{inr(g.taxable)}</td>
                          <td className="px-2 py-1.5 text-right">{inr(g.cgst)}</td>
                          <td className="px-2 py-1.5 text-right">{inr(g.sgst)}</td>
                          <td className="px-2 py-1.5 text-right">{inr(g.igst)}</td>
                          <td className="px-2 py-1.5 text-right font-bold">{inr(g.tax)}</td>
                        </tr>
                      ))}
                      {data.gst.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-2 py-3 text-center text-slate-500">
                            Is period me GST wale bill nahi
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <SectionTitle>HSN wise</SectionTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5 text-left">HSN</th>
                        <th className="px-2 py-1.5 text-right">Qty</th>
                        <th className="px-2 py-1.5 text-right">Taxable</th>
                        <th className="px-2 py-1.5 text-right">Tax</th>
                        <th className="px-2 py-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.hsn.map((h) => (
                        <tr key={h.hsn}>
                          <td className="px-2 py-1.5 font-semibold">{h.hsn}</td>
                          <td className="px-2 py-1.5 text-right">{h.qty}</td>
                          <td className="px-2 py-1.5 text-right">{inr(h.taxable)}</td>
                          <td className="px-2 py-1.5 text-right">{inr(h.tax)}</td>
                          <td className="px-2 py-1.5 text-right font-bold">{inr(h.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="text-[11px] text-slate-600">
                GSTIN: <b>{business.gstin || '—'}</b> · State: {business.state} ({business.stateCode}) — GSTR-1 filing ke liye CSV export karke CA ko bhej dein.
              </Card>
            </div>
          )}

          {/* ---------------- aging ---------------- */}
          {tab === 'aging' && (
            <div className="space-y-3">
              <Chips
                size="sm"
                value={agingSide}
                onChange={setAgingSide}
                options={[
                  { value: 'customer' as const, label: '👥 Customer se lena hai' },
                  { value: 'supplier' as const, label: '🏭 Supplier ko dena hai' },
                ]}
              />
              <Card className="flex items-center justify-between">
                <div className="text-xs text-slate-600">
                  On-account payments purane bill par FIFO adjust hoke dikhaye gaye hain.
                </div>
                <Button size="sm" variant="secondary" onClick={() => void exportCsv('aging')}>
                  ⬇ CSV
                </Button>
              </Card>

              {!aging || aging.length === 0 ? (
                <EmptyState icon="⏳" title="Koi udhaar baaki nahi" hint="Sab hisab saaf hai 👏" />
              ) : (
                <div className="space-y-2">
                  {aging.map((row) => (
                    <Card key={`${row.partyId}-${row.partyName}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-slate-800">{row.partyName}</div>
                          <div className="text-[11px] text-slate-500">
                            {row.phone || 'no number'} · sabse purana {row.oldestDays} din
                          </div>
                        </div>
                        <div className="text-right text-sm font-extrabold text-rose-600">{inr(row.total)}</div>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
                        {(['0-30', '31-60', '61-90', '90+'] as const).map((bucket) => (
                          <div key={bucket} className={`rounded-lg py-1.5 ${row.buckets[bucket] > 0.009 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                            <div className="font-semibold text-slate-500">{bucket} din</div>
                            <div className="font-bold text-slate-800">{inrShort(row.buckets[bucket])}</div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---------------- stock ---------------- */}
          {tab === 'stock' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Stock (cost)" value={inrShort(data.stock.totalCost)} tone="indigo" />
                <StatTile label="Sale value" value={inrShort(data.stock.totalSale)} tone="green" />
                <StatTile label="Total qty" value={String(r2(data.stock.totalQty))} />
              </div>

              <Card>
                <SectionTitle>Category-wise stock value</SectionTitle>
                <HBars data={data.stock.rows.map((r) => ({ label: `${r.category} (${r.items})`, value: r.costValue }))} />
              </Card>

              <Card>
                <SectionTitle>⚠ Low stock ({data.low.length})</SectionTitle>
                {data.low.length === 0 ? (
                  <p className="py-2 text-xs text-slate-500">Sab items ka stock theek hai 👌</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.low.map((i) => (
                      <div key={i.id} className="flex items-center justify-between text-xs">
                        <span className="truncate pr-2 font-semibold text-slate-700">{i.name}</span>
                        <span className="shrink-0 text-rose-600">
                          {i.stock} {i.unit} (alert {i.lowStockAlert})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ---------------- day book ---------------- */}
          {tab === 'daybook' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} className="flex-1" />
                <Button variant="secondary" onClick={() => void exportCsv('daybook')}>
                  ⬇ CSV
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Aaya (in)" value={inrShort(data.book.totalIn)} tone="green" />
                <StatTile label="Gaya (out)" value={inrShort(data.book.totalOut)} tone="red" />
              </div>
              {data.book.rows.length === 0 ? (
                <EmptyState icon="📅" title="Us din kuch nahi hua" hint="Dusri date chunein" />
              ) : (
                <Card className="p-0">
                  <div className="divide-y divide-slate-100">
                    {data.book.rows.map((r, i) => (
                      <div key={`${r.ref}-${i}`} className="flex items-center justify-between px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-800">
                            {r.label} {r.ref && <span className="text-slate-500">· {r.ref}</span>}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {r.party} · {r.detail}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs font-bold">
                          {r.inAmount > 0 && <div className="text-emerald-700">+{inr(r.inAmount)}</div>}
                          {r.outAmount > 0 && <div className="text-rose-600">−{inr(r.outAmount)}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
