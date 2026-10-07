/** More — koi bhi document/feature ek hi jagah se + ek nazar me hisaab */
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Badge, Card, SectionTitle, StatTile, useToast } from '../components/ui'
import { ALL_DOC_TYPES, DOC_LABEL, getSetting, APP_SETTINGS } from '../lib/db'
import { inrShort, today } from '../lib/format'
import { computeDue } from '../lib/repo'
import { isSaleDoc, r2 } from '../lib/calc'
import { hashPin } from '../lib/repo'
import type { Session } from '../lib/session'
import type { DocType } from '../lib/types'

export function More({
  user,
  onLogout,
  onOpenSettings,
  onSwitchCompany,
}: {
  user: Session | null
  onLogout: () => void
  onOpenSettings: () => void
  onSwitchCompany: () => void
}) {
  const { db, go, company } = useApp()
  const { toast } = useToast()

  const data = useLiveQuery(async () => {
    const [invoices, payments, parties, items, onboardedSetting, cloudSetting, users] = await Promise.all([
      db.invoices.toArray(),
      db.payments.toArray(),
      db.parties.toArray(),
      db.items.toArray(),
      getSetting(db, APP_SETTINGS.onboarded),
      getSetting(db, APP_SETTINGS.cloudConfig),
      db.users.toArray(),
    ])
    const t = today()
    const monthStart = `${t.slice(0, 7)}-01`
    let monthSale = 0
    for (const inv of invoices) {
      if (inv.cancelled || !isSaleDoc(inv.docType) || inv.date < monthStart) continue
      monthSale += inv.docType === 'credit_note' ? -inv.grandTotal : inv.grandTotal
    }
    let receivable = 0
    let payable = 0
    for (const p of parties) {
      const due = computeDue(p, invoices, payments).due
      if (p.type === 'supplier') payable += Math.max(0, due)
      else receivable += Math.max(0, due)
    }
    return {
      monthSale: r2(monthSale),
      receivable: r2(receivable),
      payable: r2(payable),
      lowStock: items.filter((i) => i.stock <= (i.lowStockAlert ?? 0)).length,
      onboarded: !!onboardedSetting,
      cloud: !!cloudSetting,
      users,
    }
  }, [db])

  const docActions = useMemo(
    () =>
      ALL_DOC_TYPES.map((d) => ({
        docType: d as DocType,
        label: DOC_LABEL[d],
        icon:
          d === 'tax_invoice' ? '🧾' : d === 'estimate' ? '📝' : d === 'proforma' ? '📄' : d === 'delivery_challan' ? '🚚' : d === 'bill_of_supply' ? '💵' : d === 'credit_note' ? '↩️' : '📥',
      })),
    [],
  )

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Is mahine ki sale" value={inrShort(data.monthSale)} tone="indigo" onClick={() => go('reports')} />
          <StatTile label="Lena hai" value={inrShort(data.receivable)} tone="amber" onClick={() => go('parties')} />
          <StatTile label="Dena hai" value={inrShort(data.payable)} tone="red" onClick={() => go('parties', { tab: 'supplier' })} />
          <StatTile label="Low stock" value={`${data.lowStock} item`} tone={data.lowStock ? 'red' : 'green'} onClick={() => go('items', { tab: 'low' })} />
        </div>
      )}

      <Card>
        <SectionTitle>Document banayein</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {docActions.map((d) => (
            <button
              key={d.docType}
              type="button"
              onClick={() => go('billing', { docType: d.docType })}
              className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-left text-xs font-semibold text-slate-700 active:bg-slate-100"
            >
              <span className="text-lg">{d.icon}</span>
              {d.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>Dukaan / hisaab</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: '📦', label: 'Items & Stock', action: () => go('items') },
            { icon: '👥', label: 'Khata / Parties', action: () => go('parties') },
            { icon: '💸', label: 'Payments In/Out', action: () => go('payments') },
            { icon: '🧮', label: 'Kharcha', action: () => go('expenses') },
            { icon: '📊', label: 'Reports', action: () => go('reports') },
            { icon: '⚙️', label: 'Settings', action: onOpenSettings },
          ].map((x) => (
            <button
              key={x.label}
              type="button"
              onClick={x.action}
              className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-left text-xs font-semibold text-slate-700 active:bg-slate-100"
            >
              <span className="text-lg">{x.icon}</span>
              {x.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-2">
        <SectionTitle right={<button className="text-xs font-semibold text-indigo-700" onClick={onSwitchCompany}>badlein</button>}>🏢 Company</SectionTitle>
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-slate-700">{company.name}</span>
          <Badge tone="indigo">{data?.cloud ? 'cloud on' : 'offline'}</Badge>
        </div>
        {user && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">
              Login: <b>{user.name}</b> ({user.role})
            </span>
            <button type="button" className="text-xs font-semibold text-rose-600" onClick={onLogout}>
              Logout
            </button>
          </div>
        )}
        <div className="text-[11px] text-slate-500">
          Users: {data?.users.length ?? 0} {data && data.users.length === 0 ? '(abhi bina login chalti hai)' : ''}
        </div>
      </Card>

      <Card className="space-y-2">
        <SectionTitle>📱 App install (PWA)</SectionTitle>
        <p className="text-[11px] text-slate-600">
          Phone me app ki tarah chalane ke liye: Chrome menu (⋮) → <b>“Install app” / “Add to Home screen”</b>. Uske baad
          internet ke bina bhi khulegi.
        </p>
        <button
          type="button"
          className="text-xs font-semibold text-indigo-700"
          onClick={async () => {
            const installed = window.matchMedia('(display-mode: standalone)').matches
            toast(installed ? 'App pehle se install hai ✅' : 'Chrome menu → Install app dabayein', 'info')
            void (await hashPin('ping'))
          }}
        >
          Install kaise karein?
        </button>
      </Card>
    </div>
  )
}
