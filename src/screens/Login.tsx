/** Login — PIN pad (offline). Owner PIN bhool jaye to yahin naya bana sakta hai. */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '../lib/db'
import { hashPin, updateUserPin, verifyUserPin } from '../lib/repo'
import type { Session } from '../lib/session'
import { Button, Modal, useToast } from '../components/ui'
import type { ID, User } from '../lib/types'

export function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const db = useMemo(() => getDb(), [])
  const users = (useLiveQuery(() => db.users.filter((u) => u.active).toArray(), [db]) ?? []) as User[]
  const [selected, setSelected] = useState<ID | null>(null)
  const [pin, setPin] = useState('')
  const [forgot, setForgot] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [error, setError] = useState('')
  const { toast } = useToast()

  const user = users.find((u) => u.id === selected) ?? (users.length === 1 ? users[0] : undefined)

  const press = async (digit: string) => {
    if (!user) return
    const next = (pin + digit).slice(0, 6)
    setPin(next)
    setError('')
    if (next.length >= 4) {
      // 4 ank poore hone par khud check — 6 ank wale PIN ke liye "→" button bhi hai
      const okNow = await verifyUserPin(db, user.id as ID, next)
      if (okNow) {
        finish(user)
        return
      }
      if (next.length === 6) {
        setError('PIN galat hai')
        setPin('')
      }
    }
  }

  const finish = (u: User) => {
    onLogin({ userId: u.id as ID, name: u.name, role: u.role, at: Date.now() })
  }

  const submit = async () => {
    if (!user) return
    const okPin = await verifyUserPin(db, user.id as ID, pin)
    if (okPin) {
      finish(user)
      return
    }
    setError('PIN galat hai — dobara try karein')
    setPin('')
  }

  const owner = users.find((u) => u.role === 'owner')

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-indigo-900 px-6 py-10 text-white">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-3xl">🔐</div>
        <h1 className="text-xl font-extrabold">Showroom Manager</h1>
        <p className="mt-1 text-sm text-indigo-200">
          {user ? `${user.name} (${user.role === 'owner' ? 'Owner' : 'Staff'}) ka PIN daalein` : 'Kaun login kar raha hai?'}
        </p>
      </div>

      {!user && (
        <div className="w-full max-w-xs space-y-2">
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                setSelected(u.id as ID)
                setPin('')
              }}
              className="flex w-full items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-left"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 font-bold">{u.name.charAt(0).toUpperCase()}</span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">{u.name}</span>
                <span className="block text-[11px] text-indigo-200">{u.role === 'owner' ? 'Owner' : 'Staff'}</span>
              </span>
              <span>→</span>
            </button>
          ))}
        </div>
      )}

      {user && (
        <>
          <div className="mb-4 flex gap-2">
            {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
              <span key={i} className={`h-3 w-3 rounded-full ${i < pin.length ? 'bg-white' : 'bg-white/25'}`} />
            ))}
          </div>
          {error && <div className="mb-3 rounded-xl bg-rose-500/90 px-3 py-1.5 text-xs font-semibold">{error}</div>}

          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => void press(d)}
                className="h-16 w-16 rounded-full bg-white/10 text-xl font-bold active:bg-white/25"
              >
                {d}
              </button>
            ))}
            <button type="button" onClick={() => setPin('')} className="h-16 w-16 rounded-full bg-white/5 text-sm font-semibold active:bg-white/20">
              Saaf
            </button>
            <button type="button" onClick={() => void press('0')} className="h-16 w-16 rounded-full bg-white/10 text-xl font-bold active:bg-white/25">
              0
            </button>
            <button type="button" onClick={() => void submit()} className="h-16 w-16 rounded-full bg-emerald-500 text-xl font-bold active:bg-emerald-600">
              ✓
            </button>
          </div>

          <div className="mt-6 text-center">
            {users.length > 1 && (
              <button
                type="button"
                className="text-xs text-indigo-200 underline"
                onClick={() => {
                  setSelected(null)
                  setPin('')
                  setError('')
                }}
              >
                Dusre user se login karein
              </button>
            )}
            {owner && user.role === 'owner' && (
              <button type="button" className="mt-3 block w-full text-xs text-indigo-200 underline" onClick={() => setForgot(true)}>
                PIN bhool gaye? Naya PIN banayein
              </button>
            )}
          </div>
        </>
      )}

      <p className="mt-8 max-w-xs text-center text-[11px] text-indigo-300">
        PIN sirf isi phone me (hash ban kar) save hota hai — internet ki zaroorat nahi.
      </p>

      <Modal open={forgot} onClose={() => setForgot(false)} title="Naya owner PIN">
        <p className="mb-3 text-sm text-slate-600">
          Owner PIN bhool jaye to yahin se naya bana sakta hai. (Ye phone aapke paas hai — isliye allowed hai.)
        </p>
        <input
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          placeholder="Naya 4-6 ank ka PIN"
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-lg tracking-widest"
        />
        <p className="mt-2 text-[11px] text-slate-500">Hash: {newPin ? (newPin.length >= 4 ? '✅ set ho jayega' : 'kam se kam 4 ank') : '——'}</p>
        <Button
          className="mt-4 w-full"
          disabled={newPin.length < 4}
          onClick={async () => {
            if (!owner?.id) return
            await updateUserPin(db, owner.id, newPin)
            const h = await hashPin(newPin)
            toast(h ? 'Naya PIN set ho gaya' : 'PIN set hua', 'success')
            setNewPin('')
            setForgot(false)
            if (owner.id) {
              setSelected(owner.id)
              setPin('')
            }
          }}
        >
          Naya PIN save karein
        </Button>
      </Modal>
    </div>
  )
}
