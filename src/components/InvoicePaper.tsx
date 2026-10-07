/**
 * Invoice paper — A4 (professional) aur 80mm thermal (printer wala).
 *
 * Ye ek hi component screen preview, print aur image-share teeno me use hota hai,
 * isliye jo dikhta hai wahi print hota hai (WYSIWYG).
 */
import { QRCodeSVG } from 'qrcode.react'
import type { Business, Invoice } from '../lib/types'
import { DOC_LABEL } from '../lib/db'
import { amountInWords, fmtDate, inr, num, qty } from '../lib/format'
import { upiLink } from '../lib/doc'

export interface InvoicePaperProps {
  invoice: Invoice
  business: Business
  mode: 'a4' | 'thermal'
  copyLabel?: string
}

export function InvoicePaper({ invoice, business, mode, copyLabel }: InvoicePaperProps) {
  if (mode === 'thermal') return <ThermalPaper invoice={invoice} business={business} />
  return <A4Paper invoice={invoice} business={business} copyLabel={copyLabel} />
}

function docTitle(inv: Invoice): string {
  if (inv.docType === 'credit_note') return 'CREDIT NOTE'
  if (inv.docType === 'bill_of_supply') return 'BILL OF SUPPLY'
  return DOC_LABEL[inv.docType].toUpperCase()
}

function taxSummary(inv: Invoice): string {
  if (inv.igst > 0) return `IGST ${inr(inv.igst)}`
  if (inv.cgst || inv.sgst) return `CGST ${inr(inv.cgst)} + SGST ${inr(inv.sgst)}`
  return '—'
}

function A4Paper({ invoice: inv, business: biz, copyLabel }: { invoice: Invoice; business: Business; copyLabel?: string }) {
  const due = Math.max(0, inv.grandTotal - inv.paid)
  const qrValue = biz.upiId && due > 0.009 ? upiLink(biz.upiId, biz.name || 'Showroom', due, inv.number) : ''

  return (
    <div className={`invoice-paper a4 relative ${inv.cancelled ? 'opacity-90' : ''}`} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {inv.cancelled && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rotate-[-18deg] border-4 border-rose-400 px-6 py-2 text-3xl font-black tracking-widest text-rose-400/70">
            CANCELLED
          </span>
        </div>
      )}

      {/* header */}
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2">
        <div className="flex items-start gap-3">
          {biz.logo ? (
            <img src={biz.logo} alt="" style={{ width: 64, height: 64, objectFit: 'contain' }} />
          ) : (
            <div style={{ width: 52, height: 52 }} className="flex items-center justify-center rounded-lg bg-slate-800 text-2xl text-white">
              🏪
            </div>
          )}
          <div>
            <div style={{ fontSize: 19 }} className="font-extrabold uppercase leading-tight text-slate-900">
              {biz.name || 'Showroom'}
            </div>
            <div className="text-slate-600">{biz.address}</div>
            <div className="text-slate-600">
              {biz.phone && <>📞 {biz.phone} · </>}
              {biz.email && <>{biz.email} · </>}
              GSTIN: {biz.gstin || '—'}
            </div>
            <div className="text-slate-600">State: {biz.state}</div>
          </div>
        </div>
        <div className="min-w-[190px] rounded-lg border border-slate-300 p-2 text-right">
          <div style={{ fontSize: 13 }} className="font-extrabold uppercase tracking-wide text-slate-800">
            {docTitle(inv)}
          </div>
          {copyLabel && <div className="text-[9px] uppercase text-slate-500">{copyLabel}</div>}
          <div className="mt-1 text-slate-700">
            No: <b>{inv.number}</b>
          </div>
          <div className="text-slate-700">Date: {fmtDate(inv.date)}</div>
          <div className="text-slate-700">Place of supply: {inv.placeOfSupply || inv.partyState || biz.state}</div>
        </div>
      </div>

      {/* party */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-300 p-2">
          <div className="text-[9px] font-bold uppercase text-slate-500">
            {inv.docType === 'purchase_bill' ? 'Supplier (Bill From)' : 'Bill To / Party'}
          </div>
          <div style={{ fontSize: 12 }} className="font-bold text-slate-900">
            {inv.partyName || 'Cash Sale'}
          </div>
          {inv.partyPhone && <div className="text-slate-600">📞 {inv.partyPhone}</div>}
          {inv.partyGstin && <div className="text-slate-600">GSTIN: {inv.partyGstin}</div>}
          {inv.partyState && <div className="text-slate-600">State: {inv.partyState}</div>}
        </div>
        <div className="rounded-lg border border-slate-300 p-2">
          <div className="text-[9px] font-bold uppercase text-slate-500">Payment</div>
          <div className="text-slate-700">
            Mode: <b>{inv.mode === 'credit' ? 'Udhaar (Credit)' : inv.mode?.toUpperCase() ?? '—'}</b>
          </div>
          <div className="text-slate-700">
            Total: <b>{inr(inv.grandTotal)}</b>
          </div>
          <div className="text-slate-700">
            Paid: <b>{inr(inv.paid)}</b>
          </div>
          <div className={`font-bold ${due > 0.009 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {due > 0.009 ? `Baaki: ${inr(due)}` : 'Poora paid ✔'}
          </div>
        </div>
      </div>

      {/* items */}
      <table className="mt-3 w-full border-collapse" style={{ fontSize: 10 }}>
        <thead>
          <tr className="bg-slate-800 text-white">
            <th className="border border-slate-700 px-1 py-1 text-left">#</th>
            <th className="border border-slate-700 px-1 py-1 text-left">Item &amp; HSN</th>
            <th className="border border-slate-700 px-1 py-1 text-right">Qty</th>
            <th className="border border-slate-700 px-1 py-1 text-right">Rate</th>
            <th className="border border-slate-700 px-1 py-1 text-right">Disc%</th>
            <th className="border border-slate-700 px-1 py-1 text-right">Taxable</th>
            <th className="border border-slate-700 px-1 py-1 text-right">GST%</th>
            <th className="border border-slate-700 px-1 py-1 text-right">Tax</th>
            <th className="border border-slate-700 px-1 py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={`${l.code}-${i}`} className={i % 2 ? 'bg-slate-50' : ''}>
              <td className="border border-slate-200 px-1 py-1">{i + 1}</td>
              <td className="border border-slate-200 px-1 py-1">
                <div className="font-semibold">{l.name}</div>
                <div className="text-[9px] text-slate-500">
                  {l.code && <>Code: {l.code} · </>}
                  {l.hsn ? `HSN: ${l.hsn}` : ''}
                </div>
              </td>
              <td className="border border-slate-200 px-1 py-1 text-right">
                {qty(l.qty)} {l.unit}
              </td>
              <td className="border border-slate-200 px-1 py-1 text-right">{num(l.rate)}</td>
              <td className="border border-slate-200 px-1 py-1 text-right">{l.discountPct ? num(l.discountPct, 1) : '-'}</td>
              <td className="border border-slate-200 px-1 py-1 text-right">{num(l.taxable)}</td>
              <td className="border border-slate-200 px-1 py-1 text-right">{num(l.gstPct, 0)}%</td>
              <td className="border border-slate-200 px-1 py-1 text-right">{num(l.taxAmount)}</td>
              <td className="border border-slate-200 px-1 py-1 text-right font-semibold">{num(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* totals */}
      <div className="mt-3 flex justify-between gap-4">
        <div className="flex-1">
          <div className="rounded-lg border border-slate-300 p-2">
            <div className="text-[9px] font-bold uppercase text-slate-500">Amount in words</div>
            <div className="text-slate-800">{amountInWords(inv.grandTotal)}</div>
          </div>
          {biz.bankAccount && (
            <div className="mt-2 rounded-lg border border-slate-300 p-2">
              <div className="text-[9px] font-bold uppercase text-slate-500">Bank details</div>
              <div className="text-slate-700">
                {biz.bankName} · A/c {biz.bankAccount}
                {biz.ifsc ? ` · IFSC ${biz.ifsc}` : ''}
              </div>
            </div>
          )}
          {biz.terms && (
            <div className="mt-2 rounded-lg border border-slate-300 p-2">
              <div className="text-[9px] font-bold uppercase text-slate-500">Terms &amp; Conditions</div>
              <div className="whitespace-pre-line text-slate-600">{biz.terms}</div>
            </div>
          )}
        </div>
        <div className="w-[230px]">
          <div className="rounded-lg border border-slate-300">
            <Row label="Sub total" value={inr(inv.subTotal)} />
            {inv.itemDiscount > 0 && <Row label="Item discount" value={`− ${inr(inv.itemDiscount)}`} />}
            {inv.billDiscount > 0 && <Row label="Bill discount" value={`− ${inr(inv.billDiscount)}`} />}
            <Row label="Taxable value" value={inr(inv.taxableValue)} />
            {inv.igst > 0 ? (
              <Row label="IGST" value={inr(inv.igst)} />
            ) : (
              <>
                <Row label="CGST" value={inr(inv.cgst)} />
                <Row label="SGST" value={inr(inv.sgst)} />
              </>
            )}
            {inv.extraCharges > 0 && <Row label="Freight / Hamali" value={inr(inv.extraCharges)} />}
            {inv.roundOff !== 0 && <Row label="Round off" value={`${inv.roundOff > 0 ? '+' : ''}${inr(inv.roundOff)}`} />}
            <div className="flex items-center justify-between border-t-2 border-slate-800 bg-slate-100 px-2 py-2">
              <span className="font-extrabold uppercase">Grand Total</span>
              <span style={{ fontSize: 14 }} className="font-extrabold">
                {inr(inv.grandTotal)}
              </span>
            </div>
          </div>

          {qrValue && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-300 p-2">
              <QRCodeSVG value={qrValue} size={64} level="M" />
              <div className="text-[10px] text-slate-600">
                <b>UPI se pay karein</b>
                <div>{biz.upiId}</div>
                <div>Baaki: {inr(due)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* footer */}
      <div className="mt-6 flex items-end justify-between">
        <div className="text-[9px] text-slate-500">
          {taxSummary(inv)}
          <div>Ye computer se banaya gaya bill hai.</div>
        </div>
        <div className="text-center">
          {biz.signature ? (
            <img src={biz.signature} alt="" style={{ height: 38, objectFit: 'contain' }} />
          ) : (
            <div style={{ height: 38 }} />
          )}
          <div className="border-t border-slate-400 px-6 pt-1 text-[9px] text-slate-600">For {biz.name || 'Showroom'}</div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1 last:border-b-0">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  )
}

/** 80mm thermal printer ka compact bill */
function ThermalPaper({ invoice: inv, business: biz }: { invoice: Invoice; business: Business }) {
  const due = Math.max(0, inv.grandTotal - inv.paid)
  const qrValue = biz.upiId && due > 0.009 ? upiLink(biz.upiId, biz.name || 'Showroom', due, inv.number) : ''
  return (
    <div className="invoice-paper thermal" style={{ fontFamily: '"Courier New", monospace' }}>
      <div className="text-center">
        <div style={{ fontSize: 14 }} className="font-bold uppercase">
          {biz.name || 'Showroom'}
        </div>
        <div>{biz.address}</div>
        {biz.phone && <div>Mob: {biz.phone}</div>}
        {biz.gstin && <div>GSTIN: {biz.gstin}</div>}
      </div>
      <div className="my-1 border-t border-dashed border-slate-500" />
      <div className="flex justify-between">
        <span>{docTitle(inv)}</span>
        <span>{inv.number}</span>
      </div>
      <div className="flex justify-between">
        <span>{fmtDate(inv.date)}</span>
        <span>{inv.mode === 'credit' ? 'UDHAAR' : (inv.mode ?? '').toUpperCase()}</span>
      </div>
      <div>Party: {inv.partyName || 'Cash'}</div>
      {inv.partyPhone && <div>Mob: {inv.partyPhone}</div>}
      <div className="my-1 border-t border-dashed border-slate-500" />
      {inv.lines.map((l, i) => (
        <div key={`${l.code}-${i}`} className="mb-1">
          <div className="font-bold">{l.name}</div>
          <div className="flex justify-between">
            <span>
              {qty(l.qty)} {l.unit} x {num(l.rate, 2)}
              {l.discountPct ? ` (-${num(l.discountPct, 0)}%)` : ''}
            </span>
            <span>{num(l.total, 2)}</span>
          </div>
        </div>
      ))}
      <div className="my-1 border-t border-dashed border-slate-500" />
      <div className="flex justify-between">
        <span>Taxable</span>
        <span>{num(inv.taxableValue, 2)}</span>
      </div>
      {inv.igst > 0 ? (
        <div className="flex justify-between">
          <span>IGST</span>
          <span>{num(inv.igst, 2)}</span>
        </div>
      ) : (
        <>
          <div className="flex justify-between">
            <span>CGST</span>
            <span>{num(inv.cgst, 2)}</span>
          </div>
          <div className="flex justify-between">
            <span>SGST</span>
            <span>{num(inv.sgst, 2)}</span>
          </div>
        </>
      )}
      {inv.extraCharges > 0 && (
        <div className="flex justify-between">
          <span>Freight</span>
          <span>{num(inv.extraCharges, 2)}</span>
        </div>
      )}
      {inv.roundOff !== 0 && (
        <div className="flex justify-between">
          <span>Round off</span>
          <span>{num(inv.roundOff, 2)}</span>
        </div>
      )}
      <div className="my-1 border-t-2 border-slate-800" />
      <div className="flex justify-between font-bold" style={{ fontSize: 13 }}>
        <span>TOTAL</span>
        <span>{num(inv.grandTotal, 2)}</span>
      </div>
      {inv.paid > 0 && (
        <>
          <div className="flex justify-between">
            <span>Paid</span>
            <span>{num(inv.paid, 2)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Baaki</span>
            <span>{num(due, 2)}</span>
          </div>
        </>
      )}
      <div className="my-1 border-t border-dashed border-slate-500" />
      <div>Items: {inv.lines.length} · Qty: {qty(inv.totalQty)}</div>
      {qrValue && (
        <div className="mt-2 text-center">
          <QRCodeSVG value={qrValue} size={78} level="M" />
          <div style={{ fontSize: 9 }}>UPI: {biz.upiId}</div>
        </div>
      )}
      <div className="mt-2 text-center" style={{ fontSize: 9 }}>
        {biz.terms || 'Maal ek baar bikne ke baad wapas nahi hoga.'}
        <br />
        Dhanyavaad! 🙏
      </div>
    </div>
  )
}
