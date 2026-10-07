/** Onboarding — pehli baar dukaan ki details (2 minute ka kaam) */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { APP_SETTINGS, currentCompanyId, getDb, renameCompany, SAMPLE_ITEMS, setSetting } from '../lib/db'
import { getBusiness, saveBusiness } from '../lib/repo'
import { Button, Card, Field, Input, Select, useToast } from '../components/ui'
import { IN_STATES } from '../lib/states'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const db = useMemo(() => getDb(), [])
  const existing = useLiveQuery(() => getBusiness(db), [db])
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    gstin: '',
    state: 'Uttar Pradesh',
    upiId: '',
    terms: 'Maal ek baar bikne ke baad wapas nahi hoga.\nBill ke 15 din ke andar payment karein.',
  })
  const [touchedName, setTouchedName] = useState(false)

  // DB se aaya naam ek hi baar bhar do (edit ke case me)
  const [prefilled, setPrefilled] = useState(false)
  if (!prefilled && existing?.name && !form.name) {
    setForm((f) => ({ ...f, ...existing, terms: existing.terms || f.terms }))
    setPrefilled(true)
  }

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  const stateCode = IN_STATES.find((s) => s.name === form.state)?.code ?? '09'

  const save = async () => {
    if (!form.name.trim()) {
      setTouchedName(true)
      toast('Dukaan ka naam likhein', 'error')
      return
    }
    setSaving(true)
    try {
      await saveBusiness(db, {
        name: form.name.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        gstin: form.gstin.trim().toUpperCase(),
        state: form.state,
        stateCode,
        upiId: form.upiId.trim(),
        terms: form.terms,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      })
      renameCompany(currentCompanyId(), form.name.trim())
      await setSetting(db, APP_SETTINGS.onboarded, '1')
      toast('Dukaan set ho gayi! 🎉', 'success')
      onDone()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-800 text-3xl text-white shadow-lg">🏪</div>
          <h1 className="text-xl font-extrabold text-slate-900">Apni dukaan set karein</h1>
          <p className="mt-1 text-sm text-slate-600">Ye details bill/invoice par chhapti hain. Baad me Settings se badal sakte hain.</p>
        </div>

        <Card className="space-y-3">
          <Field label="Dukaan / Firm ka naam" required>
            <Input
              value={form.name}
              onChange={(e) => {
                setTouchedName(true)
                set('name')(e.target.value)
              }}
              placeholder="jaise: Sharma Electronics"
              autoFocus
              className={touchedName && !form.name.trim() ? 'border-rose-400' : ''}
            />
          </Field>
          <Field label="Address">
            <Input value={form.address} onChange={(e) => set('address')(e.target.value)} placeholder="Dukaan ka pata" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile number">
              <Input value={form.phone} onChange={(e) => set('phone')(e.target.value)} inputMode="tel" placeholder="98xxxxxxxx" />
            </Field>
            <Field label="GSTIN" hint="Na ho to khaali chhod dein">
              <Input value={form.gstin} onChange={(e) => set('gstin')(e.target.value.toUpperCase())} placeholder="09ABCDE1234F1Z5" />
            </Field>
          </div>
          <Field label="State (GST ke liye)" hint="Intra-state bill par CGST+SGST, dusre state par IGST">
            <Select value={form.state} onChange={(e) => set('state')(e.target.value)}>
              {IN_STATES.map((s) => (
                <option key={s.code} value={s.name}>
                  {s.name} ({s.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="UPI ID" hint="Bill par QR print hoga — grahak seedha pay kar sakta hai">
            <Input value={form.upiId} onChange={(e) => set('upiId')(e.target.value)} placeholder="dukaan@upi" />
          </Field>
        </Card>

        <div className="mt-4 flex gap-2">
          <Button size="lg" className="flex-1" onClick={save} disabled={saving}>
            {saving ? 'Save ho raha hai…' : 'Aage badhein →'}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={async () => {
              // Demo data — item master turant bhar jata hai (baad me delete kar sakte hain)
              if ((await db.items.count()) === 0) {
                await db.items.bulkAdd(SAMPLE_ITEMS().map(({ id: _drop, ...rest }) => {
                  void _drop
                  return rest
                }))
                toast('7 demo items aa gaye — Items screen dekhein', 'success')
              } else {
                toast('Items pehle se hain', 'info')
              }
            }}
          >
            Demo items
          </Button>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          Poora data aapke phone/browser me hi rehta hai — koi server, koi login zaroori nahi.
        </p>
      </div>
    </div>
  )
}
