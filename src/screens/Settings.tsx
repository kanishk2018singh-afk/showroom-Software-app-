/** Settings — dukaan details, number series, cloud account, users, backup, self-test */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal, SectionTitle, Select, Spinner, Textarea, useToast } from '../components/ui'
import { ALL_DOC_TYPES, APP_SETTINGS, DOC_DEFAULT_PREFIX, DOC_LABEL, getSetting, renameCompany, setSetting, currentCompanyId } from '../lib/db'
import { clearAllData, createUser, getBusiness, listDocSettings, saveBusiness, saveDocSetting, updateUserPin } from '../lib/repo'
import { IN_STATES } from '../lib/states'
import { buildSnapshot, parseSnapshot, restoreSnapshot, snapshotToBlob } from '../lib/backup'
import { downloadBlob } from '../lib/util'
import { safeFile } from '../lib/format'
import { runSelfTest, type SelfTestReport } from '../lib/selftest'
import { googleSignIn, parseFirebaseConfig, signInAnon, signInEmail, signUpEmail, type CloudConfig, type CloudSession } from '../lib/cloud'
import { syncAllCompanies, syncCompany } from '../lib/sync'
import type { Business, DocSetting, User } from '../lib/types'
import type { Session } from '../lib/session'

export function Settings({ user, onLogout }: { user: Session | null; onLogout: () => void }) {
  const { company, reloadCompany } = useApp()
  const [tab, setTab] = useState<'shop' | 'series' | 'cloud' | 'users' | 'backup' | 'test'>('shop')

  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {(
          [
            ['shop', '🏪 Dukaan'],
            ['series', '🔢 Number series'],
            ['cloud', '☁️ Cloud'],
            ['users', '👤 Users'],
            ['backup', '💾 Backup'],
            ['test', '🧪 Self-test'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
              tab === key ? 'bg-indigo-700 text-white' : 'bg-white text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'shop' && <ShopSettings onSwitchCompany={reloadCompany} />}
      {tab === 'series' && <SeriesSettings />}
      {tab === 'cloud' && <CloudSettings />}
      {tab === 'users' && <UsersSettings user={user} onLogout={onLogout} />}
      {tab === 'backup' && <BackupSettings companyName={company.name} />}
      {tab === 'test' && <SelfTestCard />}
    </div>
  )
}

/* ------------------------------ Shop ------------------------------ */

function ShopSettings({ onSwitchCompany }: { onSwitchCompany: () => void }) {
  const { db, company } = useApp()
  const { toast } = useToast()
  const [form, setForm] = useState<Business | null>(null)
  const [saving, setSaving] = useState(false)
  const logoRef = useRef<HTMLInputElement | null>(null)
  const signRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void getBusiness(db).then(setForm)
  }, [db])

  if (!form) return <Spinner label="Dukaan details load ho rahi hain…" />

  const set = <K extends keyof Business>(key: K, value: Business[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))
  const stateCode = IN_STATES.find((s) => s.name === form.state)?.code ?? form.stateCode ?? '09'

  const readImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Image padhi nahi ja saki'))
      reader.readAsDataURL(file)
    })

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <SectionTitle right={<Badge tone="indigo">{company.name}</Badge>}>Dukaan ki details</SectionTitle>
        <Field label="Naam" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Address">
          <Textarea value={form.address} onChange={(e) => set('address', e.target.value)} className="min-h-[56px]" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="GSTIN">
            <Input value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} />
          </Field>
          <Field label="State">
            <Select value={form.state} onChange={(e) => set('state', e.target.value)}>
              {IN_STATES.map((s) => (
                <option key={s.code} value={s.name}>
                  {s.name} ({s.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="UPI ID">
            <Input value={form.upiId ?? ''} onChange={(e) => set('upiId', e.target.value)} placeholder="dukaan@upi" />
          </Field>
          <Field label="Bank name">
            <Input value={form.bankName ?? ''} onChange={(e) => set('bankName', e.target.value)} />
          </Field>
          <Field label="Bank A/c">
            <Input value={form.bankAccount ?? ''} onChange={(e) => set('bankAccount', e.target.value)} />
          </Field>
          <Field label="IFSC">
            <Input value={form.ifsc ?? ''} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} />
          </Field>
        </div>
        <Field label="Default terms & conditions (bill par chhapte hain)">
          <Textarea value={form.terms ?? ''} onChange={(e) => set('terms', e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">Logo</div>
            <div className="flex items-center gap-2">
              {form.logo ? <img src={form.logo} alt="logo" className="h-12 w-12 rounded-lg border border-slate-200 object-contain" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-400">🏪</div>}
              <Button size="sm" variant="secondary" onClick={() => logoRef.current?.click()}>
                Upload
              </Button>
              <input
                ref={logoRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) set('logo', await readImage(f))
                }}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">Signature</div>
            <div className="flex items-center gap-2">
              {form.signature ? <img src={form.signature} alt="sign" className="h-12 w-20 rounded-lg border border-slate-200 object-contain" /> : <div className="flex h-12 w-20 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">✍️</div>}
              <Button size="sm" variant="secondary" onClick={() => signRef.current?.click()}>
                Upload
              </Button>
              <input
                ref={signRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) set('signature', await readImage(f))
                }}
              />
            </div>
          </div>
        </div>

        <Button
          className="w-full"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              await saveBusiness(db, { ...form, stateCode })
              renameCompany(currentCompanyId(), form.name || 'Meri Dukaan')
              onSwitchCompany()
              toast('Dukaan details save ho gayi', 'success')
            } catch (e) {
              toast((e as Error).message, 'error')
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'Save ho raha…' : 'Save karein'}
        </Button>
      </Card>
    </div>
  )
}

/* ------------------------------ Series ------------------------------ */

function SeriesSettings() {
  const { db } = useApp()
  const { toast } = useToast()
  const settings = (useLiveQuery(() => listDocSettings(db), [db]) ?? []) as DocSetting[]
  const [draft, setDraft] = useState<Record<string, DocSetting>>({})

  useEffect(() => {
    setDraft(Object.fromEntries(settings.map((s) => [s.docType, s])))
  }, [settings])

  return (
    <Card className="space-y-3">
      <SectionTitle>Bill number series</SectionTitle>
      <p className="text-[11px] text-slate-500">
        Format: <b>PREFIX/FY/NUMBER</b> (jaise INV/25-26/001). Financial year badalne par number apne aap 001 se shuru ho
        jata hai. Number hamesha aage badhta hai — peeche date ka bill banane par bhi series safe rehti hai.
      </p>
      <div className="space-y-2">
        {ALL_DOC_TYPES.map((docType) => {
          const s = draft[docType] ?? { docType, prefix: DOC_DEFAULT_PREFIX[docType], nextNumber: 1, padding: 3 }
          return (
            <div key={docType} className="grid grid-cols-[1.4fr_1fr_0.9fr_0.7fr_auto] items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-600">{DOC_LABEL[docType]}</span>
              <Input
                value={s.prefix}
                onChange={(e) => setDraft((d) => ({ ...d, [docType]: { ...s, prefix: e.target.value.toUpperCase() } }))}
                className="py-1.5 text-xs"
                placeholder="INV"
              />
              <Input
                type="number"
                value={s.nextNumber}
                onChange={(e) => setDraft((d) => ({ ...d, [docType]: { ...s, nextNumber: Number(e.target.value) || 1 } }))}
                className="py-1.5 text-xs"
              />
              <Input
                type="number"
                value={s.padding}
                onChange={(e) => setDraft((d) => ({ ...d, [docType]: { ...s, padding: Number(e.target.value) || 3 } }))}
                className="py-1.5 text-xs"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await saveDocSetting(db, docType, { prefix: s.prefix, nextNumber: s.nextNumber, padding: s.padding })
                  toast(`${DOC_LABEL[docType]} series save ho gayi`, 'success')
                }}
              >
                💾
              </Button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* ------------------------------ Cloud ------------------------------ */

function CloudSettings() {
  const { db, company } = useApp()
  const { toast } = useToast()
  const [configText, setConfigText] = useState('')
  const [savedConfig, setSavedConfig] = useState('')
  const [session, setSession] = useState<CloudSession | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [lastSync, setLastSync] = useState('')

  useEffect(() => {
    void (async () => {
      setSavedConfig((await getSetting(db, APP_SETTINGS.cloudConfig)) ?? '')
      const s = await getSetting(db, APP_SETTINGS.syncAccount)
      setSession(s ? (JSON.parse(s) as CloudSession) : null)
      setLastSync((await getSetting(db, APP_SETTINGS.lastSyncAt)) ?? '')
    })()
  }, [db])

  const cfg: CloudConfig | null = useMemo(() => {
    const raw = savedConfig || configText
    if (!raw) return null
    try {
      return parseFirebaseConfig(raw)
    } catch {
      return null
    }
  }, [savedConfig, configText])

  const saveSession = async (s: CloudSession) => {
    await setSetting(db, APP_SETTINGS.syncAccount, JSON.stringify(s))
    await setSetting(db, APP_SETTINGS.syncEnabled, '1')
    setSession(s)
  }

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label)
    try {
      toast(await fn(), 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <SectionTitle>1. Firebase setup</SectionTitle>
        <p className="text-[11px] text-slate-600">
          <a className="font-semibold text-indigo-700 underline" href="https://console.firebase.google.com" target="_blank" rel="noreferrer">
            console.firebase.google.com
          </a>{' '}
          → Add project → Authentication (Email/Password enable) → Firestore Database banayein → Rules me ye paste karein:
        </p>
        <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-100">{`rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /showroomUsers/{uid}/{doc=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == uid;
    }
  }
}`}</pre>
        <p className="text-[11px] text-slate-600">
          Project settings → Your apps → <b>Web</b> → firebaseConfig copy karke neeche paste karein (poora snippet bhi chalega).
        </p>
        <Textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          placeholder={`{\n  "apiKey": "...",\n  "authDomain": "xxxx.firebaseapp.com",\n  "projectId": "xxxx"\n}`}
        />
        <Button
          variant="secondary"
          className="w-full"
          onClick={async () => {
            try {
              const parsed = parseFirebaseConfig(configText)
              await setSetting(db, APP_SETTINGS.cloudConfig, configText.trim())
              setSavedConfig(configText.trim())
              toast(`Config save ho gaya — project: ${parsed.projectId}`, 'success')
            } catch (e) {
              toast((e as Error).message, 'error')
            }
          }}
          disabled={!configText.trim()}
        >
          Config save karein
        </Button>
      </Card>

      <Card className="space-y-3">
        <SectionTitle right={cfg ? <Badge tone="green">{cfg.projectId}</Badge> : <Badge tone="red">config nahi</Badge>}>2. Login (account)</SectionTitle>
        {session ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Login: <b>{session.email || session.uid}</b>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={busy !== '' || !cfg}
                onClick={() =>
                  void run('sync', async () => {
                    if (!cfg) throw new Error('Pehle config save karein')
                    const outcome = await syncCompany(cfg, session, company.id, company.name, { push: true, pull: true })
                    setLastSync(String(Date.now()))
                    await setSetting(db, APP_SETTINGS.lastSyncAt, String(Date.now()))
                    return `Sync ho gaya (${outcome.direction})`
                  })
                }
              >
                {busy === 'sync' ? 'Sync ho raha…' : '🔄 Sync abhi'}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={busy !== '' || !cfg}
                onClick={() =>
                  void run('all', async () => {
                    if (!cfg) throw new Error('Pehle config save karein')
                    const outcomes = await syncAllCompanies(cfg, session)
                    const errs = outcomes.filter((o) => o.error)
                    if (errs.length) throw new Error(errs[0].error ?? 'Sync fail')
                    return `${outcomes.length} companies sync ho gayin`
                  })
                }
              >
                {busy === 'all' ? 'Chal raha…' : 'Saari companies sync'}
              </Button>
            </div>
            <Button
              variant="danger"
              className="w-full"
              onClick={async () => {
                await setSetting(db, APP_SETTINGS.syncEnabled, '0')
                await setSetting(db, APP_SETTINGS.syncAccount, '')
                setSession(null)
                toast('Cloud se logout ho gaya (local data safe hai)', 'success')
              }}
            >
              Cloud logout
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Field label="Email">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" />
            </Field>
            <Field label="Password" hint="Kam se kam 6 character">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy !== '' || !cfg || !email || password.length < 6}
                onClick={() =>
                  void run('login', async () => {
                    if (!cfg) throw new Error('Pehle config save karein')
                    await saveSession(await signInEmail(cfg, email, password))
                    return 'Login ho gaya — sync chalu'
                  })
                }
              >
                Login
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== '' || !cfg || !email || password.length < 6}
                onClick={() =>
                  void run('signup', async () => {
                    if (!cfg) throw new Error('Pehle config save karein')
                    await saveSession(await signUpEmail(cfg, email, password))
                    return 'Account ban gaya — sync chalu'
                  })
                }
              >
                Naya account
              </Button>
              <Button
                variant="ghost"
                disabled={busy !== '' || !cfg}
                onClick={() =>
                  void run('guest', async () => {
                    if (!cfg) throw new Error('Pehle config save karein')
                    await saveSession(await signInAnon(cfg))
                    return 'Guest login ho gaya'
                  })
                }
              >
                Guest (bina email)
              </Button>
              {cfg?.googleClientId && (
                <Button
                  variant="secondary"
                  disabled={busy !== ''}
                  onClick={() =>
                    void run('google', async () => {
                      await saveSession(await googleSignIn(cfg))
                      return 'Google se login ho gaya'
                    })
                  }
                >
                  Google se login
                </Button>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Tip: APK/WebView me Google login block hota hai — wahan email/password use karein.
            </p>
          </div>
        )}
        {lastSync && <p className="text-[11px] text-slate-500">Last sync: {new Date(Number(lastSync)).toLocaleString('en-IN')}</p>}
      </Card>
    </div>
  )
}

/* ------------------------------ Users ------------------------------ */

function UsersSettings({ user, onLogout }: { user: Session | null; onLogout: () => void }) {
  const { db } = useApp()
  const { toast } = useToast()
  const users = (useLiveQuery(() => db.users.toArray(), [db]) ?? []) as User[]
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', role: 'staff' as User['role'], pin: '' })
  const [pinFor, setPinFor] = useState<User | null>(null)
  const [newPin, setNewPin] = useState('')

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <SectionTitle>Login users</SectionTitle>
        <p className="text-[11px] text-slate-600">
          Jab tak koi user na bane, app bina login khulti hai. User banate hi PIN maanga jayega. PIN ka hash phone me hi
          rehta hai (SHA-256) — internet ki zaroorat nahi.
        </p>
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-slate-800">
                {u.name} {u.id === user?.userId && <span className="text-[10px] text-indigo-600">(aap)</span>}
              </div>
              <div className="text-[11px] text-slate-500">
                {u.role === 'owner' ? 'Owner' : 'Staff'} · {u.active ? 'active' : 'band'}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setPinFor(u); setNewPin('') }}>
                PIN badlein
              </Button>
              {users.length > 1 && u.id !== user?.userId && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await db.users.update(u.id as number, { active: false })
                    toast(`${u.name} ka login band kar diya`, 'success')
                  }}
                >
                  Band
                </Button>
              )}
            </div>
          </div>
        ))}
        <Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>
          ＋ Naya user / staff
        </Button>
        {user && (
          <Button variant="danger" className="w-full" onClick={onLogout}>
            Logout
          </Button>
        )}
      </Card>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Naya user"
        footer={
          <Button
            className="w-full"
            onClick={async () => {
              try {
                await createUser(db, form.name, form.role, form.pin)
                toast('User ban gaya — agli baar PIN maanga jayega', 'success')
                setAdding(false)
                setForm({ name: '', role: 'staff', pin: '' })
              } catch (e) {
                toast((e as Error).message, 'error')
              }
            }}
          >
            User banayein
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Naam">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Role" hint="Pehla user apne aap Owner ban jata hai">
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as User['role'] }))}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </Select>
          </Field>
          <Field label="PIN (4-6 ank)">
            <Input
              value={form.pin}
              onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
              inputMode="numeric"
              className="tracking-[0.3em]"
            />
          </Field>
          <p className="text-[11px] text-slate-500">PIN hash ban kar (SHA-256) phone me hi save hoga — kabhi plain text me nahi.</p>
        </div>
      </Modal>

      <Modal
        open={!!pinFor}
        onClose={() => setPinFor(null)}
        title={`${pinFor?.name} ka naya PIN`}
        footer={
          <Button
            className="w-full"
            disabled={newPin.length < 4}
            onClick={async () => {
              if (!pinFor?.id) return
              await updateUserPin(db, pinFor.id, newPin)
              toast('PIN badal gaya', 'success')
              setPinFor(null)
            }}
          >
            Save
          </Button>
        }
      >
        <Input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="4-6 ank ka naya PIN" className="tracking-[0.3em]" />
      </Modal>
    </div>
  )
}

/* ------------------------------ Backup ------------------------------ */

function BackupSettings({ companyName }: { companyName: string }) {
  const { db } = useApp()
  const { toast } = useToast()
  const [busy, setBusy] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [restorePreview, setRestorePreview] = useState<{ name: string; counts: Record<string, number>; snapshot: unknown } | null>(null)

  const stats = useLiveQuery(async () => ({
    items: await db.items.count(),
    invoices: await db.invoices.count(),
    parties: await db.parties.count(),
    payments: await db.payments.count(),
    expenses: await db.expenses.count(),
  }), [db])

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <SectionTitle>💾 Backup (JSON)</SectionTitle>
        <p className="text-[11px] text-slate-600">
          Poora data ek JSON file me nikal lein — phone badalne par isi file se wapas laa sakte hain. Mahine me ek baar
          backup zaroor lein (browser data clear hone par data chala jata hai).
        </p>
        {stats && (
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            {Object.entries(stats).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 py-1.5">
                <div className="font-bold text-slate-800">{v}</div>
                <div className="text-slate-500">{k}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={busy !== ''}
            onClick={() =>
              void (async () => {
                setBusy('backup')
                try {
                  const snap = await buildSnapshot(db, currentCompanyId(), companyName)
                  downloadBlob(`showroom-backup-${safeFile(companyName)}-${new Date().toISOString().slice(0, 10)}.json`, snapshotToBlob(snap))
                  await setSetting(db, 'lastBackupAt', String(Date.now()))
                  toast('Backup file download ho gayi', 'success')
                } catch (e) {
                  toast((e as Error).message, 'error')
                } finally {
                  setBusy('')
                }
              })()
            }
          >
            {busy === 'backup' ? 'Ban raha…' : '⬇ Backup nikaalein'}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => fileRef.current?.click()}>
            ⬆ Restore karein
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                const snap = parseSnapshot(await f.text())
                setRestorePreview({ name: f.name, counts: Object.fromEntries(Object.entries(snap.data).map(([k, v]) => [k, (v as unknown[]).length])), snapshot: snap })
              } catch (err) {
                toast((err as Error).message, 'error')
              }
            }}
          />
        </div>
      </Card>

      <Card className="space-y-2 border-l-4 border-rose-400">
        <SectionTitle>⚠ Poora data reset</SectionTitle>
        <p className="text-[11px] text-slate-600">
          Is company ka saara data (items, bills, khata, payments, users) mit jayega. Pehle backup le lein — warna wapas
          nahi aayega.
        </p>
        <Button variant="danger" className="w-full" onClick={() => setConfirmReset(true)}>
          Sab kuch mita dein
        </Button>
      </Card>

      <ConfirmDialog
        open={!!restorePreview}
        title="Restore karein?"
        message={`File: ${restorePreview?.name}. Is company ka purana data hat jayega aur backup ka data aa jayega.`}
        confirmLabel="Restore karo"
        tone="warning"
        onCancel={() => setRestorePreview(null)}
        onConfirm={async () => {
          if (!restorePreview) return
          try {
            const result = await restoreSnapshot(db, restorePreview.snapshot as never)
            toast(`Restore ho gaya (${Object.values(result.restored).reduce((s, n) => s + n, 0)} rows)`, 'success')
            setRestorePreview(null)
            location.reload()
          } catch (e) {
            toast((e as Error).message, 'error')
          }
        }}
      >
        {restorePreview && (
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
            {Object.entries(restorePreview.counts).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 py-1.5">
                <div className="font-bold">{v}</div>
                <div className="text-slate-500">{k}</div>
              </div>
            ))}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmReset}
        title="Poora data reset karein?"
        message="Ye undo nahi ho sakta. Sirf tab karein jab backup le liya ho."
        confirmLabel="Haan, sab mitao"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await clearAllData(db)
          toast('Data reset ho gaya — app dobara khul rahi hai', 'success')
          setTimeout(() => location.reload(), 800)
        }}
      />
    </div>
  )
}

/* ------------------------------ Self test ------------------------------ */

function SelfTestCard() {
  const [report, setReport] = useState<SelfTestReport | null>(null)
  const [running, setRunning] = useState(false)

  return (
    <Card className="space-y-3">
      <SectionTitle>🧪 App self-test</SectionTitle>
      <p className="text-[11px] text-slate-600">
        Poora billing engine browser me hi check hota hai — GST maths, number series, stock, payments, khata, purchase,
        aging, CSV, backup <b>aur sync merge</b>. Test ek temporary company (alag database) me chalta hai, isliye aapka
        asli data bilkul safe rehta hai — aur ant me wo temp database delete kar diya jata hai.
      </p>
      <Button
        className="w-full"
        disabled={running}
        onClick={async () => {
          setRunning(true)
          try {
            setReport(await runSelfTest())
          } finally {
            setRunning(false)
          }
        }}
      >
        {running ? 'Checks chal rahe…' : 'Test chalao'}
      </Button>

      {report && (
        <div className="space-y-2">
          <div className={`rounded-xl px-3 py-2 text-sm font-bold ${report.failed === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
            {report.failed === 0 ? `✅ ${report.passed} checks pass` : `❌ ${report.failed} fail · ${report.passed} pass`} ({report.durationMs} ms)
          </div>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
            {report.checks.map((c) => (
              <div key={c.name} className="flex items-start gap-2 border-b border-slate-100 px-3 py-1.5 text-[11px] last:border-b-0">
                <span>{c.ok ? '✅' : '❌'}</span>
                <span className="flex-1">
                  <span className={c.ok ? 'text-slate-700' : 'font-semibold text-rose-700'}>{c.name}</span>
                  {c.detail && <span className="block text-rose-600">{c.detail}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
