/** Expenses — dukaan ka kharcha: category-wise chart, period filter, CSV export */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Select, StatTile, useToast } from '../components/ui'
import { EXPENSE_CATEGORIES, PAY_MODES, PAY_MODE_LABEL } from '../lib/db'
import { fmtDate, inr, inrShort, today } from '../lib/format'
import { deleteExpense, saveExpense } from '../lib/repo'
import { HBars } from '../components/Charts'
import { PeriodPicker, rangeFor, type PeriodKey } from '../components/PeriodPicker'
import { expenseTable } from '../lib/reports'
import { tableToCsv } from '../lib/csv'
import { downloadBlob } from '../lib/util'
import { r2 } from '../lib/calc'
import type { Expense, PayMode } from '../lib/types'

export function Expenses() {
  const { db } = useApp()
  const { toast } = useToast()
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [range, setRange] = useState(() => rangeFor('month'))
  const [editing, setEditing] = useState<Expense | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null)

  const expenses = (useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), [db]) ?? []) as Expense[]
  const inRange = useMemo(() => expenses.filter((e) => e.date >= range.from && e.date <= range.to), [expenses, range])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of inRange) map.set(e.category, r2((map.get(e.category) ?? 0) + e.amount))
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [inRange])

  const byMode = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of inRange) map.set(e.mode, r2((map.get(e.mode) ?? 0) + e.amount))
    return [...map.entries()].map(([label, value]) => ({ label: PAY_MODE_LABEL[label] ?? label, value })).sort((a, b) => b.value - a.value)
  }, [inRange])

  const total = r2(inRange.reduce((s, e) => s + e.amount, 0))
  const monthTotal = r2(expenses.filter((e) => e.date >= `${today().slice(0, 7)}-01`).reduce((s, e) => s + e.amount, 0))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Is period ka kharcha" value={inrShort(total)} sub={`${inRange.length} entries`} tone="red" />
        <StatTile label="Is mahine ka" value={inrShort(monthTotal)} tone="amber" />
      </div>

      <Button size="lg" className="w-full" onClick={() => setEditing({ date: today(), category: EXPENSE_CATEGORIES[0], amount: 0, mode: 'cash', note: '', createdAt: Date.now(), updatedAt: Date.now() })}>
        ＋ Naya kharcha
      </Button>

      <PeriodPicker
        value={period}
        custom={range}
        onChange={(key, r) => {
          setPeriod(key)
          setRange(r)
        }}
      />

      {byCategory.length > 0 && (
        <>
          <Card>
            <div className="mb-2 text-xs font-bold text-slate-600">Category-wise kharcha</div>
            <HBars data={byCategory} tone="amber" />
          </Card>
          <Card>
            <div className="mb-2 text-xs font-bold text-slate-600">Mode-wise</div>
            <HBars data={byMode} tone="indigo" />
          </Card>
        </>
      )}

      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-slate-500">{inRange.length} entries</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => downloadBlob(`expenses-${range.from}-to-${range.to}.csv`, new Blob([tableToCsv(await expenseTable(db, range))], { type: 'text/csv' }))}
        >
          ⬇ CSV export
        </Button>
      </div>

      {inRange.length === 0 ? (
        <EmptyState icon="🧮" title="Is period me koi kharcha nahi" hint="Kiraya, salary, bijli… sab yahan likhein — net profit report me jud jayega" />
      ) : (
        <div className="space-y-2">
          {inRange.map((e) => (
            <Card key={e.id} onClick={() => setEditing(e)} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-800">{e.category}</div>
                  <div className="text-[11px] text-slate-500">
                    {fmtDate(e.date)} · {PAY_MODE_LABEL[e.mode] ?? e.mode}
                    {e.note ? ` · ${e.note}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-extrabold text-rose-600">{inr(e.amount)}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ExpenseForm
        expense={editing}
        onClose={() => setEditing(null)}
        onSave={async (exp) => {
          try {
            await saveExpense(db, exp)
            toast(exp.id ? 'Kharcha update ho gaya' : 'Kharcha add ho gaya', 'success')
            setEditing(null)
          } catch (err) {
            toast((err as Error).message, 'error')
          }
        }}
        onDelete={editing?.id ? () => setConfirmDelete(editing) : undefined}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Kharcha delete karein?"
        message="Reports aur net profit se ye entry hat jayegi."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete?.id) {
            await deleteExpense(db, confirmDelete.id)
            toast('Kharcha delete ho gaya', 'success')
          }
          setConfirmDelete(null)
          setEditing(null)
        }}
      />
    </div>
  )
}

function ExpenseForm({
  expense,
  onClose,
  onSave,
  onDelete,
}: {
  expense: Expense | null
  onClose: () => void
  onSave: (e: Expense) => void | Promise<void>
  onDelete?: () => void
}) {
  const [form, setForm] = useState<Expense | null>(expense)
  // prop badalne par form refresh
  useMemo(() => setForm(expense), [expense])
  if (!form) return null
  const set = <K extends keyof Expense>(key: K, value: Expense[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))

  return (
    <Modal
      open={!!form}
      onClose={onClose}
      title={form.id ? 'Kharcha edit' : 'Naya kharcha'}
      footer={
        <div className="flex gap-2">
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              🗑
            </Button>
          )}
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => void onSave(form)}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input type="number" inputMode="decimal" value={form.amount || ''} onChange={(e) => set('amount', Number(e.target.value) || 0)} autoFocus />
        </Field>
        <div className="col-span-2">
          <Field label="Category">
            <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Mode">
          <Select value={form.mode} onChange={(e) => set('mode', e.target.value as PayMode)}>
            {PAY_MODES.map((m) => (
              <option key={m} value={m}>
                {PAY_MODE_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note">
          <Input value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="jaise: October ka kiraya" />
        </Field>
      </div>
    </Modal>
  )
}
