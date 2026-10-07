/**
 * Billing maths — GST, discount, round-off.
 *
 * Rule: har hisaab integer paise me hota hai, aur har line ka tax alag se round hota hai
 * (GSTR-1 me line-wise tax hi chahiye hota hai). Isse '1 rupee idhar-udhar' wala
 * classic bug nahi aata.
 */
import type { DiscountMode, DocType, Invoice, InvoiceLine, Totals } from './types'

/** Rupees ko paise (integer) me — float error se bachne ke liye */
export const toPaise = (rupees: number): number => Math.round((Number(rupees) || 0) * 100)
/** Paise ko rupees me (2 decimal) */
export const toRupees = (paise: number): number => Math.round(paise) / 100
/** Rupees round to 2 decimal */
export const r2 = (n: number): number => toRupees(toPaise(n))

export interface LineInput {
  qty: number
  rate: number
  discountPct?: number
  gstPct?: number
}

export interface LineTotals {
  gross: number
  discount: number
  taxable: number
  taxAmount: number
  total: number
}

/** Ek line ka hisaab — qty × rate, phir discount %, phir GST % */
export function lineTotals(line: LineInput): LineTotals {
  const qtyP = toPaise(line.qty || 0)
  const rateP = toPaise(line.rate || 0)
  const grossP = Math.round((qtyP * rateP) / 100)
  const discPct = Number(line.discountPct) || 0
  const discountP = Math.round((grossP * discPct) / 100)
  const taxableP = grossP - discountP
  const gstPct = Number(line.gstPct) || 0
  const taxP = Math.round((taxableP * gstPct) / 100)
  return {
    gross: toRupees(grossP),
    discount: toRupees(discountP),
    taxable: toRupees(taxableP),
    taxAmount: toRupees(taxP),
    total: toRupees(taxableP + taxP),
  }
}

export interface TotalsOptions {
  /** Bill-level discount (₹ ya %) */
  billDiscount?: number
  billDiscountMode?: DiscountMode
  extraCharges?: number
  /** true = dusre state ki supply → IGST; false = CGST+SGST */
  interState?: boolean
  /** true = grand total ko rupee me round karo */
  roundOff?: boolean
}

/**
 * Poora document total.
 * Bill-level discount har line par uske weight ke hisaab se baant diya jata hai —
 * isse GST proportional aur correct rehta hai (aur CSV/GSTR report match karti hai).
 */
export function computeTotals(lines: InvoiceLine[], opts: TotalsOptions = {}): Totals {
  const interState = !!opts.interState
  const doRound = opts.roundOff !== false
  const extraP = toPaise(opts.extraCharges || 0)

  let subTotalP = 0
  let itemDiscount = 0
  let taxableP = 0
  let cgstP = 0
  let sgstP = 0
  let igstP = 0

  // Har line ka gross + discount (bill discount se pehle)
  const rows = lines.map((l) => {
    const grossP = Math.round((toPaise(l.qty) * toPaise(l.rate)) / 100)
    const discP = Math.round((grossP * (Number(l.discountPct) || 0)) / 100)
    subTotalP += grossP
    itemDiscount += discP
    return { line: l, grossP, discP, netP: grossP - discP }
  })

  const netSumP = rows.reduce((s, r) => s + r.netP, 0)

  // Bill-level discount → line-wise distribute (paise ki exactness ke saath)
  let billDiscountP = 0
  if (opts.billDiscount) {
    const mode = opts.billDiscountMode ?? 'amount'
    billDiscountP = mode === 'percent'
      ? Math.round((netSumP * (Number(opts.billDiscount) || 0)) / 100)
      : toPaise(opts.billDiscount)
    if (billDiscountP > netSumP) billDiscountP = netSumP
  }

  let allocated = 0
  rows.forEach((r, idx) => {
    const share = idx === rows.length - 1
      ? billDiscountP - allocated
      : netSumP > 0
        ? Math.round((billDiscountP * r.netP) / netSumP)
        : 0
    allocated += share
    const taxableLineP = r.netP - share
    taxableP += taxableLineP
    const taxLineP = Math.round((taxableLineP * (Number(r.line.gstPct) || 0)) / 100)
    if (interState) igstP += taxLineP
    else {
      // CGST/SGST barabar baant do; odd paisa SGST ko (GSTN bhi aisa hi karta hai)
      const half = Math.floor(taxLineP / 2)
      cgstP += half
      sgstP += taxLineP - half
    }
  })

  const beforeRoundP = taxableP + cgstP + sgstP + igstP + extraP
  const grandP = doRound ? Math.round(beforeRoundP / 100) * 100 : beforeRoundP
  const roundOffP = grandP - beforeRoundP

  return {
    totalQty: r2(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)),
    subTotal: toRupees(subTotalP),
    itemDiscount: toRupees(itemDiscount),
    billDiscount: toRupees(billDiscountP),
    extraCharges: toRupees(extraP),
    taxableValue: toRupees(taxableP),
    cgst: toRupees(cgstP),
    sgst: toRupees(sgstP),
    igst: toRupees(igstP),
    roundOff: toRupees(roundOffP),
    grandTotal: toRupees(grandP),
  }
}

/** Line object ko save-ready banao (taxable/taxAmount/total bhar ke) */
export function finalizeLine(line: Omit<InvoiceLine, 'taxable' | 'taxAmount' | 'total'>): InvoiceLine {
  const t = lineTotals(line)
  return { ...line, taxable: t.taxable, taxAmount: t.taxAmount, total: t.total }
}

/**
 * Bill-level discount ko line par apply karke "effective" lines do —
 * invoice paper par discount dikhane ke liye.
 */
export function effectiveLines(inv: Pick<Invoice, 'lines' | 'billDiscount' | 'subTotal' | 'itemDiscount'>): Array<InvoiceLine & { billDiscShare: number }> {
  const netSum = inv.subTotal - inv.itemDiscount
  let allocated = 0
  return inv.lines.map((l, idx) => {
    const share = idx === inv.lines.length - 1
      ? r2(inv.billDiscount - allocated)
      : netSum > 0
        ? r2((inv.billDiscount * l.taxable) / netSum)
        : 0
    allocated = r2(allocated + share)
    return { ...l, billDiscShare: share }
  })
}

/** Margin per piece (sale − purchase) aur margin % */
export function margin(salePrice: number, purchaseRate: number): { perPiece: number; pct: number } {
  const perPiece = r2((Number(salePrice) || 0) - (Number(purchaseRate) || 0))
  const pct = purchaseRate > 0 ? r2((perPiece / purchaseRate) * 100) : 0
  return { perPiece, pct }
}

/** Document status — paid / partial / unpaid */
export function statusOf(grandTotal: number, paid: number): 'paid' | 'partial' | 'unpaid' {
  const due = r2((Number(grandTotal) || 0) - (Number(paid) || 0))
  if (due <= 0.009) return 'paid'
  if ((Number(paid) || 0) > 0.009) return 'partial'
  return 'unpaid'
}

/** Stock par asar — kaunse documents stock kam karte hain / badhate hain */
export function stockEffect(docType: DocType): -1 | 0 | 1 {
  switch (docType) {
    case 'tax_invoice':
    case 'delivery_challan':
    case 'bill_of_supply':
      return -1 // maal gaya
    case 'credit_note':
    case 'purchase_bill':
      return 1 // maal wapas aaya / kharida
    case 'estimate':
    case 'proforma':
      return 0 // sirf kagaz, stock nahi chhua
    default:
      return 0
  }
}

/** Khata (party balance) me ginne wale documents */
export function isAccountedDoc(docType: DocType): boolean {
  return docType === 'tax_invoice' || docType === 'bill_of_supply' || docType === 'credit_note' || docType === 'purchase_bill'
}

/** Sale me ginne wale documents (reports ke liye) */
export function isSaleDoc(docType: DocType): boolean {
  return docType === 'tax_invoice' || docType === 'bill_of_supply' || docType === 'credit_note'
}

/** Udhaar aging buckets */
export const AGING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

export function bucketFor(days: number): AgingBucket {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}
