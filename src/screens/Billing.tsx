/**
 * Billing — app ka dil. Barcode/quick-add se item, discount, GST, payment mode,
 * aur save par: stock cut + payment record + (optionally) print/share.
 *
 * Poora hisaab `computeTotals` se hota hai (wahi engine jo repo use karta hai),
 * isliye screen par dikha total aur save hone wala total kabhi match nahi todenge.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import { ALL_DOC_TYPES, DOC_LABEL, PAY_MODES, PAY_MODE_LABEL, getDb } from '../lib/db'
import { computeTotals, finalizeLine, r2 } from '../lib/calc'
import { inr, qty as fmtQty, today } from '../lib/format'
import { findItem, peekDocNumber, saveInvoice, saveParty, type InvoiceInput } from '../lib/repo'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { ItemPicker, PartyPicker } from '../components/ItemPicker'
import { Badge, Button, Card, Chips, Field, Input, Modal, Select, useToast } from '../components/ui'
import { billSummaryText } from '../lib/doc'
import { printDoc, shareInvoiceImage } from '../lib/print'
import { IN_STATES, stateByName } from '../lib/states'
import type { DocType, Item, Party, PayMode } from '../lib/types'
import type { DiscountMode } from '../lib/types'

interface DraftLine {
  key: string
  itemId?: number
  code: string
  name: string
  hsn?: string
  unit: string
  qty: number
  rate: number
  discountPct: number
  gstPct: number
}

const PAYABLE_DOCS: DocType[] = ['tax_invoice', 'bill_of_supply', 'purchase_bill']

export function Billing() {
  const { db, business, go, params } = useApp()
  const { toast } = useToast()

  const docType = (params.docType as DocType) ?? 'tax_invoice'
  const isPurchase = docType === 'purchase_bill'
  const isReturn = docType === 'credit_note'

  const [date, setDate] = useState(today())
  const [party, setParty] = useState<Party | undefined>()
  const [walkIn, setWalkIn] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [billDiscount, setBillDiscount] = useState(0)
  const [billDiscountMode, setBillDiscountMode] = useState<DiscountMode>('amount')
  const [extraCharges, setExtraCharges] = useState(0)
  const [roundOff, setRoundOff] = useState(true)
  const [mode, setMode] = useState<PayMode | 'credit'>('cash')
  const [paidAmount, setPaidAmount] = useState<string>('')
  const [placeOfSupply, setPlaceOfSupply] = useState(business.state)
  const [updateItemCost, setUpdateItemCost] = useState(true)
  const [note, setNote] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [showPartyPicker, setShowPartyPicker] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [editLine, setEditLine] = useState<DraftLine | null>(null)
  const [saving, setSaving] = useState(false)
  const [numberPreview, setNumberPreview] = useState('')
  const [missingCode, setMissingCode] = useState('')
  const codeRef = useRef<HTMLInputElement | null>(null)

  const editingId = params.editInvoiceId

  /* ------------ number preview + edit mode load ------------ */
  useEffect(() => {
    void peekDocNumber(db, docType).then(setNumberPreview).catch(() => setNumberPreview(''))
  }, [db, docType])

  useEffect(() => {
    if (!editingId) return
    void (async () => {
      const inv = await db.invoices.get(editingId)
      if (!inv) return
      setDate(inv.date)
      setLines(
        inv.lines.map((l, i) => ({
          key: `e${i}-${l.code}`,
          itemId: l.itemId,
          code: l.code,
          name: l.name,
          hsn: l.hsn,
          unit: l.unit,
          qty: l.qty,
          rate: l.rate,
          discountPct: l.discountPct,
          gstPct: l.gstPct,
        })),
      )
      setBillDiscount(inv.billDiscount)
      setExtraCharges(inv.extraCharges)
      setRoundOff(inv.roundOff !== 0)
      setNote(inv.note ?? '')
      if (inv.partyId) {
        const p = await db.parties.get(inv.partyId)
        if (p) setParty(p)
      } else setWalkIn(inv.partyName)
    })()
  }, [db, editingId])

  /* ------------ party ke state se place of supply ------------ */
  useEffect(() => {
    if (party?.state) setPlaceOfSupply(party.state)
  }, [party])

  const interState = useMemo(() => {
    const buyer = stateByName(placeOfSupply)
    const seller = stateByName(business.state)
    if (!buyer || !seller) return false
    return buyer.code !== seller.code
  }, [placeOfSupply, business.state])

  /* ------------ live totals ------------ */
  const totals = useMemo(() => {
    const finalized = lines.map((l) => finalizeLine({ ...l, cost: 0 }))
    return computeTotals(finalized, { billDiscount, billDiscountMode, extraCharges, interState, roundOff })
  }, [lines, billDiscount, billDiscountMode, extraCharges, interState, roundOff])

  /* ------------ item add ------------ */
  const addItem = (item: Item, qtyAdd = 1) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId && l.itemId === item.id)
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = { ...copy[idx], qty: r2(copy[idx].qty + qtyAdd) }
        return copy
      }
      return [
        ...prev,
        {
          key: `${item.id}-${Date.now()}`,
          itemId: item.id,
          code: item.code,
          name: item.name,
          hsn: item.hsn,
          unit: item.unit || 'pc',
          qty: qtyAdd,
          rate: isPurchase ? item.purchaseRate : item.salePrice,
          discountPct: item.discountPct ?? 0,
          gstPct: item.gstPct ?? 18,
        },
      ]
    })
  }

  const addByCode = async (code: string, qtyAdd = 1): Promise<boolean> => {
    const found = await findItem(db, code)
    if (!found) {
      setMissingCode(code)
      return false
    }
    addItem(found, qtyAdd)
    toast(`${found.name} add ho gaya`, 'success')
    return true
  }

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  /* ------------ save ------------ */
  const save = async (action: 'none' | 'print' | 'share' | 'whatsapp') => {
    const payableDoc = PAYABLE_DOCS.includes(docType)
    const effectiveMode: PayMode | 'credit' = payableDoc ? mode : 'credit'
    if (!lines.length) {
      toast('Pehle item add karein', 'error')
      return
    }
    if (effectiveMode === 'credit' && !party && !walkIn.trim() && docType !== 'delivery_challan') {
      // udhaar ke liye party zaroori hai (warna kis se maangenge?)
      if (!window.confirm('Party ka naam nahi hai — udhaar bill par party zaroori hota hai. Phir bhi save karein?')) return
    }
    setSaving(true)
    try {
      const partyName = party?.name ?? walkIn.trim() ?? 'Cash Sale'
      const input: InvoiceInput = {
        id: editingId,
        docType,
        date,
        partyId: party?.id,
        partyName: partyName || 'Cash Sale',
        partyPhone: party?.phone,
        partyGstin: party?.gstin,
        partyState: party?.state || placeOfSupply,
        placeOfSupply,
        items: lines.map((l) => ({
          itemId: l.itemId,
          code: l.code,
          name: l.name,
          hsn: l.hsn,
          unit: l.unit,
          qty: l.qty,
          rate: l.rate,
          discountPct: l.discountPct,
          gstPct: l.gstPct,
        })),
        billDiscount,
        billDiscountMode,
        extraCharges,
        roundOff,
        interState,
        mode: effectiveMode,
        paidAmount: effectiveMode === 'credit' ? 0 : paidAmount === '' ? undefined : Number(paidAmount),
        note: note.trim() || undefined,
        updateItemCost: isPurchase && updateItemCost,
      }
      const res = await saveInvoice(db, input)
      const inv = res.invoice
      toast(`${DOC_LABEL[docType]} ${inv.number} save ho gaya ✅`, 'success')

      if (action === 'print') {
        printDoc({ invoice: inv, business, mode: 'a4' })
      } else if (action === 'share') {
        // native share sheet — bill ki image bhejein (WhatsApp par paste)
        const where = await shareInvoiceImage(inv, business, 'a4')
        toast(where === 'shared' ? 'Share ho gaya' : 'Image download ho gayi', 'success')
      } else if (action === 'whatsapp') {
        const text = billSummaryText(inv, business)
        const phone = party?.phone?.replace(/\D/g, '')
        const url = phone ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`
        window.open(url, '_blank')
      }
      go('invoice', { invoiceId: inv.id })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const balanceDue = r2(totals.grandTotal - (mode === 'credit' ? 0 : paidAmount === '' ? totals.grandTotal : Number(paidAmount)))

  return (
    <div className="space-y-3 pb-4">
      {/* doc type + number */}
      <Card className="space-y-3">
        <Chips
          size="sm"
          value={docType}
          onChange={(v) => go('billing', { docType: v })}
          options={ALL_DOC_TYPES.filter((d) => d !== 'credit_note' || params.docType === 'credit_note' || true).map((d) => ({
            value: d,
            label: DOC_LABEL[d],
          }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={isPurchase ? 'Purchase bill number' : 'Bill number'} hint="Settings se series badal sakte hain">
            <Input value={numberPreview} readOnly className="bg-slate-50 font-semibold" />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max="2100-12-31" onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* party */}
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600">{isPurchase ? 'Supplier' : isReturn ? 'Return kis party se' : 'Party / Grahak'}</span>
          {party && <Badge tone="indigo">{party.type}</Badge>}
        </div>
        <div className="flex gap-2">
          <Input
            value={party?.name ?? walkIn}
            onChange={(e) => {
              setParty(undefined)
              setWalkIn(e.target.value)
            }}
            placeholder={isPurchase ? 'Supplier ka naam' : 'Naam (khaali = Cash sale)'}
          />
          <Button variant="secondary" onClick={() => setShowPartyPicker(true)}>
            👥
          </Button>
        </div>
        {party?.phone && <div className="text-[11px] text-slate-500">📞 {party.phone}</div>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Place of supply">
            <Select value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
              {IN_STATES.map((s) => (
                <option key={s.code} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <div className={`w-full rounded-xl px-3 py-2.5 text-xs font-semibold ${interState ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'}`}>
              {interState ? 'IGST lagega (dusre state)' : 'CGST + SGST lagega (same state)'}
            </div>
          </div>
        </div>
      </Card>

      {/* items */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600">Items ({lines.length})</span>
          <button type="button" className="text-xs font-semibold text-indigo-700" onClick={() => setShowPicker(true)}>
            ＋ Item chunein
          </button>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              ref={codeRef}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const code = codeInput.trim()
                  if (!code) return
                  const found = await addByCode(code)
                  if (found) setCodeInput('')
                }
              }}
              placeholder="Code / barcode / naam likh kar Enter…"
              inputMode="search"
            />
          </div>
          <Button variant="secondary" onClick={() => setShowScanner(true)} title="Camera scan">
            📷
          </Button>
        </div>

        {lines.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            Item add karne ke liye code likhein, 📷 se scan karein ya ＋ se list se chunein.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-2 py-2">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditLine(l)}>
                  <div className="truncate text-sm font-semibold text-slate-800">{l.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {fmtQty(l.qty)} {l.unit} × {inr(l.rate)}
                    {l.discountPct ? ` · −${l.discountPct}%` : ''} · GST {l.gstPct}%
                  </div>
                </button>
                <div className="text-right">
                  <div className="text-sm font-bold text-slate-900">{inr(r2(l.qty * l.rate * (1 - l.discountPct / 100)))}</div>
                  <div className="flex items-center justify-end gap-1 pt-0.5">
                    <button
                      type="button"
                      className="h-7 w-7 rounded-lg bg-slate-100 text-sm font-bold text-slate-700"
                      onClick={() => updateLine(l.key, { qty: Math.max(0.5, r2(l.qty - 1)) })}
                    >
                      −
                    </button>
                    <button type="button" className="h-7 w-7 rounded-lg bg-slate-100 text-sm font-bold text-slate-700" onClick={() => updateLine(l.key, { qty: r2(l.qty + 1) })}>
                      ＋
                    </button>
                    <button
                      type="button"
                      className="h-7 w-7 rounded-lg bg-rose-50 text-sm font-bold text-rose-600"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* discount + charges */}
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bill discount">
            <div className="flex gap-1">
              <Input type="number" inputMode="decimal" value={billDiscount || ''} placeholder="0" onChange={(e) => setBillDiscount(Number(e.target.value) || 0)} />
              <button
                type="button"
                onClick={() => setBillDiscountMode(billDiscountMode === 'amount' ? 'percent' : 'amount')}
                className="shrink-0 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700"
                title="₹ ya % badlein"
              >
                {billDiscountMode === 'amount' ? '₹' : '%'}
              </button>
            </div>
          </Field>
          <Field label="Extra charges (freight/hamali)">
            <Input type="number" inputMode="decimal" value={extraCharges || ''} placeholder="0" onChange={(e) => setExtraCharges(Number(e.target.value) || 0)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} className="h-4 w-4" />
          Grand total ko rupee me round karein
        </label>
        {isPurchase && (
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={updateItemCost} onChange={(e) => setUpdateItemCost(e.target.checked)} className="h-4 w-4" />
            Item ka purchase rate is bill se update karein
          </label>
        )}
      </Card>

      {/* totals */}
      <Card className="space-y-1.5 bg-indigo-50">
        <TotalRow label="Sub total" value={inr(totals.subTotal)} />
        {totals.itemDiscount > 0 && <TotalRow label="Item discount" value={`− ${inr(totals.itemDiscount)}`} />}
        {totals.billDiscount > 0 && <TotalRow label="Bill discount" value={`− ${inr(totals.billDiscount)}`} />}
        <TotalRow label="Taxable value" value={inr(totals.taxableValue)} />
        {interState ? (
          <TotalRow label="IGST" value={inr(totals.igst)} />
        ) : (
          <>
            <TotalRow label="CGST" value={inr(totals.cgst)} />
            <TotalRow label="SGST" value={inr(totals.sgst)} />
          </>
        )}
        {totals.extraCharges > 0 && <TotalRow label="Freight / Hamali" value={inr(totals.extraCharges)} />}
        {totals.roundOff !== 0 && <TotalRow label="Round off" value={`${totals.roundOff > 0 ? '+' : ''}${inr(totals.roundOff)}`} />}
        <div className="mt-1 flex items-center justify-between border-t-2 border-indigo-200 pt-2">
          <span className="text-sm font-extrabold uppercase text-indigo-900">Grand total</span>
          <span className="text-lg font-extrabold text-indigo-900">{inr(totals.grandTotal)}</span>
        </div>
      </Card>

      {/* payment */}
      {PAYABLE_DOCS.includes(docType) && (
        <Card className="space-y-3">
          <div className="text-xs font-bold text-slate-600">{isPurchase ? 'Supplier ko payment' : 'Payment'}</div>
          <Chips
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              ...PAY_MODES.map((m) => ({ value: m as PayMode, label: PAY_MODE_LABEL[m] })),
              { value: 'credit' as const, label: 'Udhaar (baad me)' },
            ]}
          />
          {mode !== 'credit' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kitna mila / diya" hint={`Poora: ${inr(totals.grandTotal)}`}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={paidAmount}
                  placeholder={String(totals.grandTotal)}
                  onChange={(e) => setPaidAmount(e.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <div className={`w-full rounded-xl px-3 py-2.5 text-xs font-semibold ${balanceDue > 0.009 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {balanceDue > 0.009 ? `Baaki rahega: ${inr(balanceDue)}` : 'Poora paid ✔'}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-2">
        <Field label="Note (bill par nahi chhapta)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="jaise: delivery kal, packing extra…" />
        </Field>
      </Card>

      {/* actions */}
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" onClick={() => void save('none')} disabled={saving || !lines.length}>
          {saving ? 'Save ho raha…' : editingId ? '✅ Update' : '💾 Save'}
        </Button>
        <Button size="lg" variant="secondary" onClick={() => void save('print')} disabled={saving || !lines.length}>
          🖨 Save + Print
        </Button>
        <Button size="lg" variant="secondary" onClick={() => void save('share')} disabled={saving || !lines.length}>
          📤 Save + Share
        </Button>
        <Button size="lg" variant="success" onClick={() => void save('whatsapp')} disabled={saving || !lines.length}>
          💬 WhatsApp
        </Button>
      </div>

      {/* modals */}
      <ItemPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onPick={(item) => addItem(item)}
        allowNew={() => {
          setShowPicker(false)
          go('items', { tab: 'new' })
        }}
      />

      <PartyPicker
        open={showPartyPicker}
        onClose={() => setShowPartyPicker(false)}
        side={isPurchase ? 'supplier' : 'customer'}
        onPick={(p) => setParty(p)}
        onClear={() => {
          setParty(undefined)
          setWalkIn('')
        }}
        onNew={async (name, phone) => {
          const id = await saveParty(db, {
            type: isPurchase ? 'supplier' : 'customer',
            name,
            phone,
            address: '',
            gstin: '',
            state: '',
            openingBalance: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          const created = await db.parties.get(id)
          if (created) setParty(created)
          toast('Party ban gayi', 'success')
        }}
      />

      <BarcodeScanner
        open={showScanner}
        onClose={() => setShowScanner(false)}
        onDetect={async (code) => {
          const found = await addByCode(code)
          if (found) toast(`Scan: ${code}`, 'success')
        }}
      />

      {/* line edit */}
      <Modal
        open={!!editLine}
        onClose={() => setEditLine(null)}
        title={editLine?.name ?? 'Item'}
        footer={
          <Button className="w-full" onClick={() => setEditLine(null)}>
            Theek hai
          </Button>
        }
      >
        {editLine && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Qty">
              <Input type="number" inputMode="decimal" value={editLine.qty} onChange={(e) => updateLine(editLine.key, { qty: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={`Rate (${isPurchase ? 'purchase' : 'sale'})`}>
              <Input type="number" inputMode="decimal" value={editLine.rate} onChange={(e) => updateLine(editLine.key, { rate: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Discount %">
              <Input type="number" inputMode="decimal" value={editLine.discountPct} onChange={(e) => updateLine(editLine.key, { discountPct: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="GST %">
              <Select value={String(editLine.gstPct)} onChange={(e) => updateLine(editLine.key, { gstPct: Number(e.target.value) })}>
                {[0, 5, 12, 18, 28].map((g) => (
                  <option key={g} value={g}>
                    {g}%
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="HSN">
              <Input value={editLine.hsn ?? ''} onChange={(e) => updateLine(editLine.key, { hsn: e.target.value })} />
            </Field>
            <Field label="Unit">
              <Input value={editLine.unit} onChange={(e) => updateLine(editLine.key, { unit: e.target.value })} />
            </Field>
            <div className="col-span-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Line total: <b>{inr(r2(editLine.qty * editLine.rate * (1 - editLine.discountPct / 100)))}</b> + GST {editLine.gstPct}%
            </div>
          </div>
        )}
      </Modal>

      {/* item nahi mila */}
      <Modal
        open={!!missingCode}
        onClose={() => setMissingCode('')}
        title="Item nahi mila"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setMissingCode('')}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                const code = missingCode
                setMissingCode('')
                go('items', { tab: 'new', docType: code })
              }}
            >
              Naya item banayein
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Code <b>{missingCode}</b> ka koi item nahi hai. Naya item banayein (code pehle se bhara hua milega) — phir billing par
          wapas aakar add kar lein.
        </p>
      </Modal>
    </div>
  )
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  )
}

export function getBillingDb() {
  return getDb()
}
