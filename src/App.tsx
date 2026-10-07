/**
 * App shell — boot, gates (onboarding / login), navigation, sync ticker.
 * Screen-level kaam screens/ me hai; ye file sirf "frame" hai.
 */
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AppProvider, useApp, type Screen } from './store'
import { createCompany, ensureBootstrap, getSetting, setSetting, APP_SETTINGS, currentCompanyId } from './lib/db'
import { getDb } from './lib/db'
import { clearSession, loadSession, loginRequired, saveSession, type Session } from './lib/session'
import { ToastProvider, useToast } from './components/ui'
import { Onboarding } from './screens/Onboarding'
import { Login } from './screens/Login'
import { Home } from './screens/Home'
import { Billing } from './screens/Billing'
import { Invoices } from './screens/Invoices'
import { InvoiceView } from './screens/InvoiceView'
import { Items } from './screens/Items'
import { Parties } from './screens/Parties'
import { Payments } from './screens/Payments'
import { Expenses } from './screens/Expenses'
import { Reports } from './screens/Reports'
import { More } from './screens/More'
import { Settings } from './screens/Settings'
import { parseFirebaseConfig, type CloudConfig, type CloudSession } from './lib/cloud'
import { syncCompany } from './lib/sync'
import { inrShort } from './lib/format'

const NAV: Array<{ screen: Screen; label: string; icon: string }> = [
  { screen: 'home', label: 'Home', icon: '🏠' },
  { screen: 'billing', label: 'Billing', icon: '🧾' },
  { screen: 'items', label: 'Items', icon: '📦' },
  { screen: 'parties', label: 'Khata', icon: '👥' },
  { screen: 'more', label: 'More', icon: '☰' },
]

export default function App() {
  return (
    <ToastProvider>
      <Boot />
    </ToastProvider>
  )
}

/** Boot: DB bootstrap karo, phir gates ke hisaab se Onboarding / Login / App frame */
function Boot() {
  const db = useMemo(() => getDb(), [])
  const [ready, setReady] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [sessionUser, setSessionUser] = useState<Session | null>(() => loadSession())
  const [bootError, setBootError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await ensureBootstrap(db, { seedItems: currentCompanyId() === 'default' })
        const onboarded = await getSetting(db, APP_SETTINGS.onboarded)
        const business = await db.business.toCollection().first()
        if (!onboarded && !business?.name) setNeedsOnboarding(true)
        setNeedsLogin(await loginRequired(db))
      } catch (e) {
        setBootError((e as Error).message || 'App khul nahi payi')
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [db])

  const bootEl = document.getElementById('boot')

  useEffect(() => {
    if (ready) bootEl?.remove()
  }, [ready, bootEl])

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-slate-500">
        <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
        App khul rahi hai…
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="p-6 text-center">
        <div className="mb-2 text-3xl">😟</div>
        <h1 className="text-lg font-bold text-slate-800">App khul nahi payi</h1>
        <p className="mt-1 text-sm text-slate-600">{bootError}</p>
        <p className="mt-3 text-xs text-slate-500">
          Browser ka data (IndexedDB) blocked ho sakta hai — private/incognito mode ya site settings check karein.
        </p>
        <button onClick={() => location.reload()} className="mt-4 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white">
          Dobara koshish karein
        </button>
      </div>
    )
  }

  if (needsOnboarding) {
    return (
      <Onboarding
        onDone={() => {
          setNeedsOnboarding(false)
          setNeedsLogin(false)
        }}
      />
    )
  }

  if (needsLogin && !sessionUser) {
    return (
      <Login
        onLogin={(session) => {
          saveSession(session)
          setSessionUser(session)
          setNeedsLogin(false)
        }}
      />
    )
  }

  return (
    <AppProvider>
      <Frame
        user={sessionUser}
        onLogout={() => {
          clearSession()
          setSessionUser(null)
          setNeedsLogin(true)
        }}
      />
    </AppProvider>
  )
}

/** Main frame: header + screens + bottom nav */
function Frame({ user, onLogout }: { user: Session | null; onLogout: () => void }) {
  const { screen, go, company, companies, switchCompany, business, db } = useApp()
  const { toast } = useToast()
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'error' | 'ok'>('idle')

  // Cloud sync: app khulte hi + har 3 minute me (agar setup hai)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const raw = await getSetting(db, APP_SETTINGS.cloudConfig)
      const enabled = (await getSetting(db, APP_SETTINGS.syncEnabled)) === '1'
      const sessionRaw = await getSetting(db, APP_SETTINGS.syncAccount)
      if (!raw || !enabled || !sessionRaw) return
      try {
        setSyncState('syncing')
        const cfg = parseFirebaseConfig(raw) as CloudConfig
        const session = JSON.parse(sessionRaw) as CloudSession
        const outcome = await syncCompany(cfg, session, company.id, company.name)
        if (!cancelled) {
          setSyncState('ok')
          void outcome
        }
      } catch {
        if (!cancelled) setSyncState('error')
      }
    }
    void run()
    const timer = setInterval(run, 3 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [db, company.id, company.name])

  const dueTotal = useLiveQuery(async () => {
    const [invoices, payments] = await Promise.all([db.invoices.toArray(), db.payments.toArray()])
    let due = 0
    for (const inv of invoices) {
      if (inv.cancelled || inv.docType === 'purchase_bill' || inv.docType === 'estimate' || inv.docType === 'proforma' || inv.docType === 'delivery_challan') continue
      due += inv.grandTotal - inv.paid
    }
    for (const p of payments) {
      if (p.partyId === undefined) due -= p.kind === 'in' ? p.amount : -p.amount
    }
    return Math.max(0, due)
  }, [db])

  const titles: Record<Screen, string> = {
    home: business.name || 'Showroom',
    billing: 'Naya Bill',
    invoices: 'Bills',
    invoice: 'Bill',
    items: 'Items & Stock',
    parties: 'Khata / Parties',
    payments: 'Payments In / Out',
    expenses: 'Kharcha',
    reports: 'Reports',
    more: 'More',
    settings: 'Settings',
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col bg-slate-100">
      {/* header */}
      <header className="sticky top-0 z-30 bg-indigo-900 px-4 pb-3 pt-4 text-white shadow-lg">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="flex items-center gap-2 text-left" onClick={() => setShowSwitcher(true)}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-lg">🏪</span>
            <span>
              <span className="block text-sm font-bold leading-tight">{titles[screen]}</span>
              <span className="block text-[11px] text-indigo-200">
                {company.name}
                {companies.length > 1 ? ` · ${companies.length} firms` : ''} ▾
              </span>
            </span>
          </button>
          <div className="flex items-center gap-1">
            <span
              className={`mr-1 rounded-full px-2 py-1 text-[10px] font-semibold ${
                syncState === 'error' ? 'bg-rose-500/80' : syncState === 'syncing' ? 'bg-amber-500/80' : syncState === 'ok' ? 'bg-emerald-500/80' : 'bg-white/10'
              }`}
              title="Cloud sync"
            >
              {syncState === 'error' ? '⚠ sync' : syncState === 'syncing' ? '⟳ sync' : syncState === 'ok' ? '✔ sync' : 'offline'}
            </span>
            <button
              type="button"
              onClick={() => (screen === 'settings' ? go('more') : go('settings'))}
              className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold"
            >
              ⚙️
            </button>
          </div>
        </div>
        {dueTotal !== undefined && dueTotal > 0.009 && screen === 'home' && (
          <div className="mt-2 rounded-xl bg-white/10 px-3 py-1.5 text-[11px]">
            Udhaar baaki: <b>{inrShort(dueTotal)}</b> — <button type="button" className="underline" onClick={() => go('reports', { tab: 'aging' })}>aging dekhein</button>
          </div>
        )}
      </header>

      {/* body */}
      <main className="flex-1 px-3 pb-24 pt-3">
        {screen === 'home' && <Home />}
        {screen === 'billing' && <Billing />}
        {screen === 'invoices' && <Invoices />}
        {screen === 'invoice' && <InvoiceView />}
        {screen === 'items' && <Items />}
        {screen === 'parties' && <Parties />}
        {screen === 'payments' && <Payments />}
        {screen === 'expenses' && <Expenses />}
        {screen === 'reports' && <Reports />}
        {screen === 'more' && (
          <More
            user={user}
            onLogout={onLogout}
            onOpenSettings={() => go('settings')}
            onSwitchCompany={() => setShowSwitcher(true)}
          />
        )}
        {screen === 'settings' && <Settings user={user} onLogout={onLogout} />}
      </main>

      {/* bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-3xl border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="grid grid-cols-5">
          {NAV.map((tab) => {
            const active = screen === tab.screen || (tab.screen === 'invoices' && screen === 'invoice')
            return (
              <button
                key={tab.screen}
                type="button"
                onClick={() => go(tab.screen)}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${active ? 'text-indigo-700' : 'text-slate-500'}`}
              >
                <span className="text-lg leading-none">{tab.icon}</span>
                {tab.label}
              </button>
            )
          })}
        </div>
      </nav>

      {/* company switcher */}
      {showSwitcher && (
        <CompanySwitcher
          onClose={() => setShowSwitcher(false)}
          onSwitch={(id) => {
            switchCompany(id)
            toast('Company badal rahi hai…', 'info')
          }}
          onNew={async (name) => {
            const meta = createCompany(name)
            await setSetting(db, APP_SETTINGS.onboarded, '1')
            switchCompany(meta.id)
          }}
        />
      )}
    </div>
  )
}

function CompanySwitcher({ onClose, onSwitch, onNew }: { onClose: () => void; onSwitch: (id: string) => void; onNew: (name: string) => void }) {
  const { companies, company } = useApp()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-900/40" onClick={onClose}>
      <div className="animate-in w-full rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-bold text-slate-800">🏢 Company / Firm</h3>
        <div className="space-y-2">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSwitch(c.id)}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-sm ${
                c.id === company.id ? 'border-indigo-600 bg-indigo-50 font-bold text-indigo-800' : 'border-slate-200'
              }`}
            >
              <span>{c.name}</span>
              {c.id === company.id && <span>✔</span>}
            </button>
          ))}
        </div>
        {adding ? (
          <div className="mt-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nayi company ka naam"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white"
              onClick={() => {
                if (name.trim()) onNew(name.trim())
              }}
            >
              Banao
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="mt-3 w-full rounded-xl border border-dashed border-indigo-400 px-3 py-3 text-sm font-semibold text-indigo-700">
            ＋ Nayi company
          </button>
        )}
        <p className="mt-2 text-[11px] text-slate-500">Har company ka data alag rehta hai (alag database).</p>
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700">
          Band karein
        </button>
      </div>
    </div>
  )
}
