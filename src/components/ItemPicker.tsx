/** Item/party picker — billing me 2 second me item ya party chunne ke liye */
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '../lib/db'
import { Badge, Button, Input, Modal, SearchInput } from './ui'
import { inr, qty } from '../lib/format'
import type { Item, Party } from '../lib/types'

/** Item dhundhne wala modal — code, naam ya barcode se */
export function ItemPicker({
  open,
  onClose,
  onPick,
  allowNew,
}: {
  open: boolean
  onClose: () => void
  onPick: (item: Item) => void
  allowNew?: () => void
}) {
  const db = useMemo(() => getDb(), [])
  const [query, setQuery] = useState('')
  const items = (useLiveQuery(() => db.items.toArray(), [db]) ?? []) as Item[]

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.code.toLowerCase().includes(q) ||
            (i.barcode ?? '').toLowerCase().includes(q) ||
            (i.brand ?? '').toLowerCase().includes(q),
        )
      : items
    return list.slice(0, 60).sort((a, b) => a.name.localeCompare(b.name))
  }, [items, query])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Item chunein"
      footer={
        allowNew ? (
          <Button variant="secondary" className="w-full" onClick={allowNew}>
            ＋ Naya item banayein
          </Button>
        ) : undefined
      }
    >
      <SearchInput value={query} onChange={setQuery} placeholder="Naam / code / barcode" />
      <div className="mt-3 space-y-2">
        {results.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onPick(item)
              onClose()
            }}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left active:bg-slate-50"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-800">{item.name}</span>
              <span className="block text-[11px] text-slate-500">
                {item.code}
                {item.brand ? ` · ${item.brand}` : ''} · GST {item.gstPct}%
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-bold text-slate-900">{inr(item.salePrice)}</span>
              <span className={`block text-[11px] ${item.stock <= (item.lowStockAlert ?? 0) ? 'text-rose-600' : 'text-slate-500'}`}>
                stock {qty(item.stock)}
              </span>
            </span>
          </button>
        ))}
        {results.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-500">
            {items.length === 0 ? 'Item master khaali hai — pehle item banayein' : 'Kuch nahi mila'}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Party picker — customer/supplier chuno ya naya banao */
export function PartyPicker({
  open,
  onClose,
  onPick,
  onNew,
  onClear,
  side = 'customer',
}: {
  open: boolean
  onClose: () => void
  onPick: (party: Party) => void
  onNew?: (name: string, phone: string) => void
  onClear?: () => void
  side?: 'customer' | 'supplier'
}) {
  const db = useMemo(() => getDb(), [])
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const parties = (useLiveQuery(() => db.parties.orderBy('name').toArray(), [db]) ?? []) as Party[]

  useEffect(() => {
    if (open) {
      setQuery('')
      setNewName('')
      setNewPhone('')
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = parties.filter((p) => (side === 'supplier' ? p.type !== 'customer' : p.type !== 'supplier'))
    return q ? list.filter((p) => p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q)) : list
  }, [parties, query, side])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={side === 'supplier' ? 'Supplier chunein' : 'Party (grahak) chunein'}
      footer={
        onClear ? (
          <Button variant="secondary" className="w-full" onClick={() => { onClear(); onClose() }}>
            Cash sale (party ke bina)
          </Button>
        ) : undefined
      }
    >
      <SearchInput value={query} onChange={setQuery} placeholder="Naam ya mobile number" />
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {results.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onPick(p)
              onClose()
            }}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-left active:bg-slate-50"
          >
            <span>
              <span className="block text-sm font-semibold text-slate-800">{p.name}</span>
              <span className="block text-[11px] text-slate-500">
                {p.phone || 'no number'} {p.gstin ? `· ${p.gstin}` : ''}
              </span>
            </span>
            {p.type !== 'customer' && p.type !== 'supplier' && <Badge tone="blue">both</Badge>}
          </button>
        ))}
        {results.length === 0 && <div className="py-4 text-center text-xs text-slate-500">Koi party nahi mili</div>}
      </div>

      {onNew && (
        <div className="mt-4 rounded-xl border border-dashed border-indigo-300 p-3">
          <div className="mb-2 text-xs font-bold text-indigo-800">＋ Naya banao</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Naam" />
            <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Mobile" inputMode="tel" />
            <Button
              disabled={!newName.trim()}
              onClick={() => {
                onNew(newName.trim(), newPhone.trim())
                onClose()
              }}
            >
              Banao
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
