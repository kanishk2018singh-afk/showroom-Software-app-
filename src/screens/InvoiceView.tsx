/** Invoice view — paper preview + saare actions (print, share, payment, convert, cancel) */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../store'
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Select, useToast, Chips } from '../components/ui'
import { InvoicePaper } from '../components/InvoicePaper'
import { DOC_LABEL, PAY_MODES, PAY_MODE_LABEL } from '../lib/db'
import { inr, waLink } from '../lib/format'
import { r2 } from '../lib/calc'
import { addPayment, cancelInvoice, convertInvoice, creditNoteFromInvoice, duplicateInvoice, deleteInvoice } from '../lib/repo'
import { billSummaryText } from '../lib/doc'
import { printDoc, shareInvoiceImage } from '../lib/print'
import { copyText } from '../lib/util'
import type { DocType, PayMode } from '../lib/types'

export function InvoiceView() {
  const { db, business, params, go } = useApp()
  const { toast } = useToast()
  const [paperMode, setPaperMode] = useState<'a4' | 'thermal'>('a4')
  const [showPayment, setShowPayment] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const invoice = useLiveQuery(() => (params.invoiceId ? db.invoices.get(params.invoiceId) : undefined), [db, params.invoiceId])

  const due = useMemo(() => (invoice ? r2(invoice.grandTotal - invoice.paid) : 0), [invoice])

  if (!invoice) {
    return (
      <EmptyState
        icon="🔍"
        title="Bill nahi mila"
        hint="Shayad delete ho gaya hai"
        action={
          <Button className="mt-2" onClick={() => go('invoices')}>
            Bills list
          </Button>
        }
      />
    )
  }

  const run = async (fn: () => Promise<void>, successMessage: string) => {
    setBusy(true)
    try {
      await fn()
      toast(successMessage, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* status bar */}
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-extrabold text-slate-900">{DOC_LABEL[invoice.docType]} · {invoice.number}</div>
            <div className="text-[11px] text-slate-500">
              {invoice.date} · {invoice.partyName || 'Cash Sale'}
            </div>
          </div>
          {invoice.cancelled ? (
            <Badge tone="red">Cancelled</Badge>
          ) : due <= 0.009 ? (
            <Badge tone="green">Poora paid</Badge>
          ) : invoice.paid > 0.009 ? (
            <Badge tone="amber">Aadha paid</Badge>
          ) : (
            <Badge tone="red">Baaki {inr(due)}</Badge>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 py-2">
            <div className="text-[10px] uppercase text-slate-500">Total</div>
            <div className="text-sm font-extrabold">{inr(invoice.grandTotal)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 py-2">
            <div className="text-[10px] uppercase text-slate-500">Paid</div>
            <div className="text-sm font-extrabold">{inr(invoice.paid)}</div>
          </div>
          <div className={`rounded-xl py-2 ${due > 0.009 ? 'bg-rose-50' : 'bg-emerald-50'}`}>
            <div className="text-[10px] uppercase text-slate-500">Baaki</div>
            <div className="text-sm font-extrabold">{inr(due)}</div>
          </div>
        </div>
        {invoice.cancelReason && <div className="text-[11px] text-rose-600">Cancel reason: {invoice.cancelReason}</div>}
        {invoice.note && <div className="text-[11px] text-slate-500">Note: {invoice.note}</div>}
      </Card>

      {/* actions */}
      <Card className="space-y-2">
        <Chips
          size="sm"
          value={paperMode}
          onChange={setPaperMode}
          options={[
            { value: 'a4' as const, label: '🖨 A4 invoice' },
            { value: 'thermal' as const, label: '🧾 80mm thermal' },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => printDoc({ invoice, business, mode: paperMode })}>🖨 Print / PDF</Button>
          <Button
            variant="success"
            onClick={() =>
              window.open(
                waLink(invoice.partyPhone, billSummaryText(invoice, business)),
                '_blank',
              )
            }
          >
            💬 WhatsApp text
          </Button>
          <Button variant="secondary" onClick={() => void run(async () => { await copyText(billSummaryText(invoice, business)) }, 'Bill text copy ho gaya')}>
            📋 Copy text
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void run(async () => {
                const where = await shareInvoiceImage(invoice, business, paperMode)
                toast(where === 'shared' ? 'Share ho gaya' : 'Image download ho gayi', 'success')
              }, '')
            }
          >
            📤 Image share
          </Button>
        </div>

        {!invoice.cancelled && ['tax_invoice', 'bill_of_supply', 'purchase_bill'].includes(invoice.docType) && due > 0.009 && (
          <Button variant="warning" className="w-full" onClick={() => setShowPayment(true)}>
            💰 Payment lein / dein ({inr(due)})
          </Button>
        )}
      </Card>

      {/* more actions */}
      <Card className="space-y-2">
        <div className="text-xs font-bold text-slate-600">Aur kya kar sakte hain</div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" onClick={() => go('billing', { editInvoiceId: invoice.id, docType: invoice.docType })} disabled={!!invoice.cancelled}>
            ✏️ Edit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void run(async () => {
                const id = await duplicateInvoice(db, invoice.id as number)
                go('invoice', { invoiceId: id })
              }, 'Bill duplicate ho gaya')
            }
          >
            🧬 Duplicate
          </Button>
          {invoice.docType === 'estimate' && !invoice.cancelled && (
            <Button
              size="sm"
              onClick={() =>
                void run(async () => {
                  const id = await convertInvoice(db, invoice.id as number, 'tax_invoice')
                  go('invoice', { invoiceId: id })
                }, 'Tax invoice ban gaya — stock kat gaya')
              }
            >
              ➡️ Tax Invoice banao
            </Button>
          )}
          {invoice.docType === 'proforma' && !invoice.cancelled && (
            <Button
              size="sm"
              onClick={() =>
                void run(async () => {
                  const id = await convertInvoice(db, invoice.id as number, 'tax_invoice')
                  go('invoice', { invoiceId: id })
                }, 'Tax invoice ban gaya')
              }
            >
              ➡️ Tax Invoice
            </Button>
          )}
          {invoice.docType === 'delivery_challan' && !invoice.cancelled && (
            <Button
              size="sm"
              onClick={() =>
                void run(async () => {
                  const id = await convertInvoice(db, invoice.id as number, 'tax_invoice')
                  go('invoice', { invoiceId: id })
                }, 'Tax invoice ban gaya')
              }
            >
              ➡️ Bill banao
            </Button>
          )}
          {['tax_invoice', 'bill_of_supply'].includes(invoice.docType) && !invoice.cancelled && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  const id = await creditNoteFromInvoice(db, invoice.id as number)
                  go('invoice', { invoiceId: id })
                }, 'Credit note (return) ban gaya — stock wapas juda')
              }
            >
              ↩️ Return / Credit Note
            </Button>
          )}
          {!invoice.cancelled && invoice.docType !== 'credit_note' && (
            <Button size="sm" variant="danger" onClick={() => setShowCancel(true)}>
              🚫 Cancel
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setShowDelete(true)}>
            🗑 Delete
          </Button>
        </div>
      </Card>

      {/* preview */}
      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-bold text-slate-600">Preview ({paperMode === 'a4' ? 'A4' : '80mm'})</span>
          <span className="text-[11px] text-slate-400">Print par yahi chhapega</span>
        </div>
        <div className="overflow-x-auto rounded-2xl bg-slate-200 p-2">
          <div className="mx-auto w-fit origin-top scale-[0.62] sm:scale-75 lg:scale-90">
            <InvoicePaper invoice={invoice} business={business} mode={paperMode} />
          </div>
        </div>
      </div>

      {/* payment modal */}
      <PaymentModal
        open={showPayment}
        onClose={() => setShowPayment(false)}
        invoiceId={invoice.id as number}
        due={due}
        kind={invoice.docType === 'purchase_bill' ? 'out' : 'in'}
        onDone={() => setShowPayment(false)}
      />

      <ConfirmDialog
        open={showCancel}
        title="Bill cancel karein?"
        message="Stock wapas item master me jud jayega. Bill record rahega (report me cancel dikhega) — isse GST return me galti nahi hoti."
        confirmLabel="Cancel bill"
        onCancel={() => setShowCancel(false)}
        onConfirm={async () => {
          await cancelInvoice(db, invoice.id as number, 'App se cancel kiya')
          setShowCancel(false)
          toast('Bill cancel ho gaya — stock wapas juda', 'success')
        }}
      />

      <ConfirmDialog
        open={showDelete}
        title="Bill delete karein?"
        message="Bill aur uske payments hamesha ke liye mit jayenge (stock bhi adjust hoga). Reports me ye bill nahi rahega."
        confirmLabel="Delete"
        onCancel={() => setShowDelete(false)}
        onConfirm={async () => {
          await deleteInvoice(db, invoice.id as number)
          setShowDelete(false)
          toast('Bill delete ho gaya', 'success')
          go('invoices')
        }}
      />

      {busy && <div className="fixed inset-x-0 top-2 z-50 text-center text-xs text-slate-500">Kaam chal raha hai…</div>}
    </div>
  )
}

function PaymentModal({
  open,
  onClose,
  invoiceId,
  due,
  kind,
  onDone,
}: {
  open: boolean
  onClose: () => void
  invoiceId: number
  due: number
  kind: 'in' | 'out'
  onDone: () => void
}) {
  const { db } = useApp()
  const { toast } = useToast()
  const [amount, setAmount] = useState(String(due))
  const [mode, setMode] = useState<PayMode>('cash')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === 'in' ? 'Payment lein' : 'Payment dein'}
      footer={
        <Button
          className="w-full"
          onClick={async () => {
            try {
              const invoice = await db.invoices.get(invoiceId)
              await addPayment(db, {
                kind,
                date: new Date().toISOString().slice(0, 10),
                partyId: invoice?.partyId,
                partyName: invoice?.partyName,
                invoiceId,
                invoiceNumber: invoice?.number,
                amount: Number(amount) || 0,
                mode,
                ref: ref.trim() || undefined,
                note: note.trim() || undefined,
              })
              toast('Payment ho gaya ✅', 'success')
              onDone()
            } catch (e) {
              toast((e as Error).message, 'error')
            }
          }}
        >
          Payment save karein
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label={kind === 'in' ? 'Kitna mila' : 'Kitna diya'} hint={`Baaki: ${inr(due)}`}>
          <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAmount(String(due))}>
            Poora ({inr(due)})
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAmount(String(r2(due / 2)))}>
            Aadha
          </Button>
        </div>
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value as PayMode)}>
            {PAY_MODES.map((m) => (
              <option key={m} value={m}>
                {PAY_MODE_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ref / Cheque no. (optional)">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UPI ref / cheque number" />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export type { DocType }
