/** Period selector — aaj / 7 din / mahina / FY / custom (reports, payments, kharcha me) */
import { useState } from 'react'
import { addDays, fyStart, isoDate, today } from '../lib/format'
import { Button, Chips, Input, Modal } from './ui'
import type { DateRange } from '../lib/types'

export type PeriodKey = 'today' | '7d' | 'month' | 'fy' | 'custom'

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: 'Aaj',
  '7d': '7 din',
  month: 'Is mahina',
  fy: 'Is saal (FY)',
  custom: 'Custom',
}

export function rangeFor(key: PeriodKey, custom?: DateRange): DateRange {
  const t = today()
  switch (key) {
    case 'today':
      return { from: t, to: t }
    case '7d':
      return { from: addDays(t, -6), to: t }
    case 'month':
      return { from: `${t.slice(0, 7)}-01`, to: t }
    case 'fy':
      return { from: fyStart(), to: t }
    case 'custom':
      return custom ?? { from: addDays(t, -30), to: t }
    default:
      return { from: t, to: t }
  }
}

export function PeriodPicker({
  value,
  custom,
  onChange,
}: {
  value: PeriodKey
  custom?: DateRange
  onChange: (key: PeriodKey, range: DateRange) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>(custom ?? rangeFor('month'))

  const pick = (key: PeriodKey) => {
    if (key === 'custom') {
      setDraft(custom ?? rangeFor('month'))
      setOpen(true)
      return
    }
    onChange(key, rangeFor(key))
  }

  return (
    <div>
      <Chips
        size="sm"
        value={value}
        onChange={pick}
        options={(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => ({
          value: k,
          label: k === 'custom' && value === 'custom' && custom ? `${custom.from} → ${custom.to}` : PERIOD_LABEL[k],
        }))}
      />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Custom period"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                const safe: DateRange = draft.from > draft.to ? { from: draft.to, to: draft.from } : draft
                setOpen(false)
                onChange('custom', safe)
              }}
            >
              Lagao
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Se (from)</span>
            <Input type="date" value={draft.from} max={today()} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Tak (to)</span>
            <Input type="date" value={draft.to} max={today()} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </label>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Tip: purana data dekhne ke liye FY chunein ya custom dates lagayein.</p>
      </Modal>
    </div>
  )
}

export function defaultRange(key: PeriodKey = 'month'): DateRange {
  return rangeFor(key)
}

export { isoDate }
