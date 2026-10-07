/** Payment register — bill-wise aur khata-wise dono payments ek jagah */
import { Badge, Card } from './ui'
import { fmtDate, inr } from '../lib/format'
import { PAY_MODE_LABEL } from '../lib/db'
import type { Payment } from '../lib/types'

export function PaymentRegister({
  payments,
  onOpenInvoice,
  onDelete,
}: {
  payments: Payment[]
  onOpenInvoice?: (id: number) => void
  onDelete?: (p: Payment) => void
}) {
  return (
    <div className="space-y-2">
      {payments.map((p) => (
        <Card key={p.id} className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-bold text-slate-800">{p.partyName || 'Cash'}</span>
                <Badge tone={p.kind === 'in' ? 'green' : 'red'}>{p.kind === 'in' ? 'IN' : 'OUT'}</Badge>
                <Badge tone="slate">{PAY_MODE_LABEL[p.mode] ?? p.mode}</Badge>
                {p.onAccount && <Badge tone="blue">on-account</Badge>}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {fmtDate(p.date)}
                {p.invoiceNumber ? (
                  <>
                    {' · '}
                    {onOpenInvoice && p.invoiceId ? (
                      <button type="button" className="font-semibold text-indigo-700 underline" onClick={() => onOpenInvoice(p.invoiceId as number)}>
                        {p.invoiceNumber}
                      </button>
                    ) : (
                      p.invoiceNumber
                    )}
                  </>
                ) : (
                  ' · khaate me'
                )}
                {p.ref ? ` · ref ${p.ref}` : ''}
                {p.note ? ` · ${p.note}` : ''}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`text-sm font-extrabold ${p.kind === 'in' ? 'text-emerald-700' : 'text-rose-600'}`}>
                {p.kind === 'in' ? '+' : '−'}
                {inr(p.amount)}
              </div>
              {onDelete && (
                <button type="button" className="mt-1 text-[11px] font-semibold text-rose-600" onClick={() => onDelete(p)}>
                  delete
                </button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
