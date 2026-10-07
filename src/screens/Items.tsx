/** Items & Stock — master, margin, low stock, CSV import/export */
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Badge, Button, Card, Chips, ConfirmDialog, EmptyState, Field, Input, Modal, SearchInput, Select, useToast } from '../components/ui'
import { emptyItem, deleteItem, saveItem } from '../lib/repo'
import { margin, r2 } from '../lib/calc'
import { inr, num, qty } from '../lib/format'
import { itemsFromCsv, itemsToCsv, itemTemplateCsv } from '../lib/csv'
import { downloadBlob } from '../lib/util'
import { safeFile } from '../lib/format'
import type { Item } from '../lib/types'

const UNITS = ['pc', 'kg', 'g', 'ltr', 'ml', 'mtr', 'box', 'pkt', 'set', 'pair', 'dozen', 'bundle']

export function Items() {
  const { db, params, go } = useApp()
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'low'>('all')
  const [editing, setEditing] = useState<Item | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importWarnings, setImportWarnings] = useState<string[]>([])

  const items = (useLiveQuery(() => db.items.toArray(), [db]) ?? []) as Item[]

  // Billing se "naya item" aaya ho (params.tab === 'new') to form kholo
  useEffect(() => {
    if (params.tab === 'new') {
      const prefillCode = (params.docType as string) ?? ''
      setEditing({ ...emptyItem(), code: prefillCode })
      go('items', { tab: 'list' })
    }
  }, [params, go])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = items
    if (tab === 'low') list = list.filter((i) => i.stock <= (i.lowStockAlert ?? 0))
    if (q)
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.code.toLowerCase().includes(q) ||
          (i.barcode ?? '').includes(q) ||
          (i.brand ?? '').toLowerCase().includes(q) ||
          (i.category ?? '').toLowerCase().includes(q),
      )
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [items, query, tab])

  const stockValue = r2(items.reduce((s, i) => s + i.stock * i.purchaseRate, 0))
  const lowCount = items.filter((i) => i.stock <= (i.lowStockAlert ?? 0)).length

  const onImport = async () => {
    const result = itemsFromCsv(importText)
    if (!result.items.length) {
      toast(result.errors[0] ?? 'CSV me kuch nahi mila', 'error')
      return
    }
    let added = 0
    let updated = 0
    for (const item of result.items) {
      const existing = await db.items.where('code').equals(item.code).first()
      if (existing?.id) {
        await db.items.update(existing.id, { ...item, id: existing.id, stock: item.stock, updatedAt: Date.now() })
        updated += 1
      } else {
        const { id: _drop, ...rest } = item
        void _drop
        await db.items.add(rest as Item)
        added += 1
      }
    }
    setImportWarnings(result.errors.slice(0, 5))
    toast(`${added} naye, ${updated} update hue${result.skipped ? `, ${result.skipped} skip` : ''}`, 'success')
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Item, code, barcode, brand…" />
        </div>
        <Button onClick={() => setEditing({ ...emptyItem(), code: '' })}>＋ Naya</Button>
      </div>

      <Chips
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'all', label: `Sab items (${items.length})` },
          { value: 'low', label: `⚠ Low stock (${lowCount})` },
        ]}
      />

      <Card className="flex items-center justify-between py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase text-slate-500">Stock value (cost)</div>
          <div className="text-base font-extrabold text-slate-900">{inr(stockValue)}</div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => downloadBlob(`items-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([itemsToCsv(items)], { type: 'text/csv' }))}
          >
            ⬇ Export
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { setImportText(''); setImportWarnings([]); setShowImport(true) }}>
            ⬆ Import CSV
          </Button>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon="📦"
          title={items.length ? 'Is filter me kuch nahi' : 'Item master khaali hai'}
          hint="Item add karein ya purani CSV file import karein"
          action={
            <Button className="mt-2" onClick={() => setEditing({ ...emptyItem(), code: '' })}>
              ＋ Pehla item banayein
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const m = margin(item.salePrice, item.purchaseRate)
            const low = item.stock <= (item.lowStockAlert ?? 0)
            return (
              <Card key={item.id} onClick={() => setEditing(item)} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-800">{item.name}</span>
                      {low && <Badge tone="red">low</Badge>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {item.code} {item.brand ? `· ${item.brand}` : ''} {item.category ? `· ${item.category}` : ''} · GST {item.gstPct}%
                      {item.hsn ? ` · HSN ${item.hsn}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-extrabold text-slate-900">{inr(item.salePrice)}</div>
                    <div className={`text-[11px] ${low ? 'text-rose-600' : 'text-slate-500'}`}>stock {qty(item.stock)} {item.unit}</div>
                    <div className="text-[10px] text-emerald-700">
                      margin {inr(m.perPiece)} ({num(m.pct, 0)}%)
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* item form */}
      <ItemForm
        item={editing}
        onClose={() => setEditing(null)}
        onSave={async (item) => {
          try {
            await saveItem(db, item)
            toast(item.id ? 'Item update ho gaya' : 'Item ban gaya', 'success')
            setEditing(null)
          } catch (e) {
            toast((e as Error).message, 'error')
          }
        }}
        onDelete={
          editing?.id
            ? async () => {
                setConfirmDelete(editing)
              }
            : undefined
        }
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Item delete karein?"
        message={`"${confirmDelete?.name}" hamesha ke liye hat jayega. Purane bills par asar nahi padega (unme naam save hai).`}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete?.id) {
            await deleteItem(db, confirmDelete.id)
            toast('Item delete ho gaya', 'success')
          }
          setConfirmDelete(null)
          setEditing(null)
        }}
      />

      {/* CSV import */}
      <Modal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="CSV import (Excel)"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => downloadBlob('items-template.csv', new Blob([itemTemplateCsv()], { type: 'text/csv' }))}>
              Template download
            </Button>
            <Button className="flex-1" onClick={() => void onImport()} disabled={!importText.trim()}>
              Import karein
            </Button>
          </div>
        }
      >
        <p className="mb-2 text-xs text-slate-600">
          Purani app ki CSV file bhi chalegi — columns ke naam se pehchan hoti hai (Name, Code, Purchase Rate, Stock, GST, MRP…).
          Excel se "Save as CSV" karke file chunein:
        </p>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setImportText(await file.text())
          }}
          className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="…ya CSV text yahan paste karein"
          className="h-32 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
        />
        {importWarnings.length > 0 && (
          <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {importWarnings.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
          </div>
        )}
        {importText.trim() && (
          <div className="mt-2 text-[11px] text-slate-500">
            Pehchani gayi rows: {itemsFromCsv(importText).items.length} · skipped: {itemsFromCsv(importText).skipped}
          </div>
        )}
      </Modal>
    </div>
  )
}

function ItemForm({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: Item | null
  onClose: () => void
  onSave: (item: Item) => void | Promise<void>
  onDelete?: () => void | Promise<void>
}) {
  const [form, setForm] = useState<Item | null>(item)

  useEffect(() => {
    setForm(item)
  }, [item])

  if (!form) return null
  const set = <K extends keyof Item>(key: K, value: Item[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))
  const m = margin(form.salePrice, form.purchaseRate)

  return (
    <Modal
      open={!!form}
      onClose={onClose}
      title={form.id ? 'Item edit' : 'Naya item'}
      wide
      footer={
        <div className="flex gap-2">
          {onDelete && (
            <Button variant="danger" onClick={() => void onDelete()}>
              🗑
            </Button>
          )}
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => void onSave(form)}>
            Save karein
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Item ka naam" required>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="jaise: Steel Kadhai 24cm" />
          </Field>
        </div>
        <Field label="Code" hint="Khaali chhodein to SR001 auto ban jayega">
          <Input value={form.code} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Barcode">
          <Input value={form.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} />
        </Field>
        <Field label="Brand">
          <Input value={form.brand ?? ''} onChange={(e) => set('brand', e.target.value)} />
        </Field>
        <Field label="Category">
          <Input value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="Steel / Home…" />
        </Field>
        <Field label="Sub-category">
          <Input value={form.subCategory ?? ''} onChange={(e) => set('subCategory', e.target.value)} />
        </Field>
        <Field label="HSN code">
          <Input value={form.hsn ?? ''} onChange={(e) => set('hsn', e.target.value)} placeholder="7323" />
        </Field>
        <Field label="Unit">
          <Select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="GST %">
          <Select value={String(form.gstPct)} onChange={(e) => set('gstPct', Number(e.target.value))}>
            {[0, 5, 12, 18, 28].map((g) => (
              <option key={g} value={g}>
                {g}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="MRP">
          <Input type="number" inputMode="decimal" value={form.mrp || ''} onChange={(e) => set('mrp', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Item discount %">
          <Input type="number" inputMode="decimal" value={form.discountPct || ''} onChange={(e) => set('discountPct', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Purchase rate (cost)">
          <Input type="number" inputMode="decimal" value={form.purchaseRate || ''} onChange={(e) => set('purchaseRate', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Sale price">
          <Input type="number" inputMode="decimal" value={form.salePrice || ''} onChange={(e) => set('salePrice', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Stock">
          <Input type="number" inputMode="decimal" value={form.stock || ''} onChange={(e) => set('stock', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Low stock alert">
          <Input type="number" inputMode="decimal" value={form.lowStockAlert || ''} onChange={(e) => set('lowStockAlert', Number(e.target.value) || 0)} />
        </Field>
        <div className="col-span-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Margin per piece: <b>{inr(m.perPiece)}</b> ({num(m.pct, 1)}%) · MRP se {inr(r2(form.mrp - form.salePrice))} kam me bik raha hai
        </div>
      </div>
      {form.id && (
        <p className="mt-3 text-[11px] text-slate-500">
          Item file: {safeFile(form.name)}. Purane bills me item ka naam freeze rehta hai, isliye naam badalne se purani report nahi badalti.
        </p>
      )}
    </Modal>
  )
}
