/**
 * Document helpers — WhatsApp text, UPI payment link, bill summary lines.
 * Sab kuch plain text me, taaki WhatsApp/SMS me bina formatting ke theek dikhe.
 */
import { inr, amountInWords, fmtDate } from './format'
import { DOC_LABEL } from './db'
import type { Business, Invoice, Party } from './types'
import type { PartyDue } from './repo'

export function billSummaryText(inv: Invoice, business: Business): string {
  const lines: string[] = []
  lines.push(`*${business.name || 'Showroom'}*`)
  if (business.phone) lines.push(`📞 ${business.phone}`)
  lines.push('')
  lines.push(`*${DOC_LABEL[inv.docType]} ${inv.number}*`)
  lines.push(`Date: ${fmtDate(inv.date)}`)
  if (inv.partyName) lines.push(`Party: ${inv.partyName}`)
  lines.push('')
  inv.lines.forEach((l, i) => {
    lines.push(`${i + 1}. ${l.name}`)
    lines.push(`   ${l.qty} ${l.unit} × ${inr(l.rate)}${l.discountPct ? ` (−${l.discountPct}%)` : ''} = ${inr(l.total)}`)
  })
  lines.push('')
  if (inv.itemDiscount) lines.push(`Item discount: −${inr(inv.itemDiscount)}`)
  if (inv.billDiscount) lines.push(`Bill discount: −${inr(inv.billDiscount)}`)
  if (inv.extraCharges) lines.push(`Extra (freight/hamali): +${inr(inv.extraCharges)}`)
  if (inv.cgst || inv.sgst) {
    lines.push(`CGST: ${inr(inv.cgst)}`)
    lines.push(`SGST: ${inr(inv.sgst)}`)
  }
  if (inv.igst) lines.push(`IGST: ${inr(inv.igst)}`)
  if (inv.roundOff) lines.push(`Round off: ${inv.roundOff > 0 ? '+' : ''}${inr(inv.roundOff)}`)
  lines.push(`*TOTAL: ${inr(inv.grandTotal)}*`)
  if (inv.paid > 0) {
    lines.push(`Paid: ${inr(inv.paid)}`)
    const due = inv.grandTotal - inv.paid
    if (due > 0.009) lines.push(`*Baaki: ${inr(due)}*`)
  }
  lines.push('')
  if (business.upiId) lines.push(`UPI: ${business.upiId}`)
  if (business.bankName && business.bankAccount) lines.push(`Bank: ${business.bankName} A/c ${business.bankAccount}${business.ifsc ? ` (IFSC ${business.ifsc})` : ''}`)
  lines.push('')
  lines.push(`Amount in words: ${amountInWords(inv.grandTotal)}`)
  if (business.terms) {
    lines.push('')
    lines.push(business.terms)
  }
  lines.push('')
  lines.push('— Dhanyavaad! 🙏')
  return lines.join('\n')
}

export function reminderText(business: Business, party: Party | undefined, due: PartyDue, opts: { isSupplier?: boolean } = {}): string {
  const name = party?.name || 'Grahak'
  const amount = inr(Math.abs(due.due))
  const lines: string[] = []
  if (opts.isSupplier) {
    lines.push(`Namaste ${name} ji,`)
    lines.push(`Hamari dukaan *${business.name}* ki taraf se aapko *${amount}* dena hai.`)
    lines.push('Kripya apna payment detail bhej dein taaki hum turant transfer kar sakein.')
  } else {
    lines.push(`Namaste ${name} ji,`)
    lines.push(`*${business.name}* ki taraf se aapka *${amount}* baaki hai.`)
    lines.push('Kripya jaldi payment kar dein ya is message par reply karein.')
  }
  lines.push('')
  if (business.upiId) lines.push(`UPI se pay karein: ${business.upiId}`)
  if (business.bankAccount) lines.push(`Bank: ${business.bankName ?? ''} A/c ${business.bankAccount}${business.ifsc ? ` (IFSC ${business.ifsc})` : ''}`)
  lines.push(`Total business: ${inr(due.billed)} · Jama: ${inr(due.paid)}`)
  lines.push('')
  lines.push('— Dhanyavaad 🙏')
  return lines.join('\n')
}

/** UPI deep link — QR me yahi string jati hai (PhonePe/GPay/Paytm sab samajhte hain) */
export function upiLink(upiId: string, payeeName: string, amount?: number, note?: string): string {
  const params = new URLSearchParams()
  params.set('pa', upiId)
  params.set('pn', payeeName)
  if (amount && amount > 0) params.set('am', amount.toFixed(2))
  params.set('cu', 'INR')
  if (note) params.set('tn', note)
  return `upi://pay?${params.toString()}`
}
