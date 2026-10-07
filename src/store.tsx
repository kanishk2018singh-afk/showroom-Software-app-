/**
 * App store — context ke through db, business, company aur navigation.
 * Screens sirf `useApp()` bulate hain, props threading ki zaroorat nahi.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { currentCompanyId, getDb, listCompanies, setCurrentCompany, type CompanyMeta, type ShowroomDB } from './lib/db'
import { getBusiness } from './lib/repo'
import type { Business } from './lib/types'

export type Screen =
  | 'home' | 'billing' | 'invoices' | 'invoice' | 'items' | 'parties'
  | 'payments' | 'expenses' | 'reports' | 'more' | 'settings'

export interface NavParams {
  invoiceId?: number
  editInvoiceId?: number
  docType?: string
  partyId?: number
  tab?: string
  kind?: 'in' | 'out'
  from?: Screen
}

interface AppCtx {
  db: ShowroomDB
  company: CompanyMeta
  companies: CompanyMeta[]
  business: Business
  screen: Screen
  params: NavParams
  go: (screen: Screen, params?: NavParams) => void
  switchCompany: (id: string) => void
  reloadCompany: () => void
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<CompanyMeta[]>(() => listCompanies())
  const [companyId, setCompanyId] = useState<string>(() => currentCompanyId())
  const [screen, setScreen] = useState<Screen>('home')
  const [params, setParams] = useState<NavParams>({})

  const db = useMemo(() => getDb(), [])
  const business = useLiveQuery(() => getBusiness(db), [db]) as Business | undefined

  const go = useCallback((next: Screen, nextParams: NavParams = {}) => {
    setScreen(next)
    setParams(nextParams)
    window.scrollTo({ top: 0 })
  }, [])

  // Android back button / browser back — screen close ho, app se bahar nahi
  useEffect(() => {
    const onPop = () => {
      if (screen !== 'home') {
        setScreen('home')
        setParams({})
      } else {
        history.pushState(null, '', location.href)
      }
    }
    history.pushState(null, '', location.href)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [screen])

  const value: AppCtx = {
    db,
    company: companies.find((c) => c.id === companyId) ?? companies[0],
    companies,
    business: business ?? {
      name: '', address: '', phone: '', gstin: '', state: 'Uttar Pradesh', stateCode: '09', createdAt: 0, updatedAt: 0,
    },
    screen,
    params,
    go,
    switchCompany: (id) => {
      setCurrentCompany(id)
      location.reload()
    },
    reloadCompany: () => {
      setCompanies(listCompanies())
      setCompanyId(currentCompanyId())
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp sirf AppProvider ke andar chalta hai')
  return ctx
}
