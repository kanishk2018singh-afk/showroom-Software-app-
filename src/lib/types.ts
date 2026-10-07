/**
 * Domain types — poore app ka single source of truth.
 * Money fields rupees me (2 decimal tak) store hote hain; arithmetic `calc.ts` me
 * integer paise par hoti hai taaki float error na aaye.
 */

export type ID = number

/** Document types — jo bhi printable/billable cheez ban sakti hai. */
export type DocType =
  | 'tax_invoice' // pukka bill (GST)
  | 'estimate' // quotation
  | 'proforma' // proforma invoice
  | 'delivery_challan'
  | 'bill_of_supply' // bina GST
  | 'credit_note' // sales return
  | 'purchase_bill' // supplier se maal

export type PartyType = 'customer' | 'supplier' | 'both'
export type PayMode = 'cash' | 'upi' | 'card' | 'bank' | 'cheque'
export type PayKind = 'in' | 'out'
export type Role = 'owner' | 'staff'
export type DiscountMode = 'amount' | 'percent'
export type DocStatus = 'unpaid' | 'partial' | 'paid'

export interface Business {
  id?: ID
  name: string
  address: string
  phone: string
  email?: string
  gstin: string
  /** State name, e.g. "Uttar Pradesh" */
  state: string
  /** GST state code, e.g. "09" — place of supply decide karta hai */
  stateCode: string
  upiId?: string
  bankName?: string
  bankAccount?: string
  ifsc?: string
  /** data URL (base64) — Settings se upload */
  logo?: string
  signature?: string
  terms?: string
  createdAt: number
  updatedAt: number
}

export interface Item {
  id?: ID
  code: string
  name: string
  barcode?: string
  brand?: string
  category?: string
  subCategory?: string
  hsn?: string
  unit: string
  mrp: number
  discountPct: number
  gstPct: number
  purchaseRate: number
  salePrice: number
  stock: number
  lowStockAlert: number
  createdAt: number
  updatedAt: number
}

export interface Party {
  id?: ID
  type: PartyType
  name: string
  phone?: string
  address?: string
  gstin?: string
  state?: string
  /** Purana bakaya (lena hai / dena hai) — sign se pata chalta hai */
  openingBalance: number
  createdAt: number
  updatedAt: number
}

export interface InvoiceLine {
  itemId?: ID
  code: string
  name: string
  hsn?: string
  unit: string
  qty: number
  /** Sale rate per unit (discount se pehle) */
  rate: number
  discountPct: number
  gstPct: number
  /** Billing ke waqt ka purchase rate — profit report historical rehti hai */
  cost?: number
  /** qty × rate − item discount */
  taxable: number
  taxAmount: number
  total: number
}

export interface Totals {
  totalQty: number
  subTotal: number
  itemDiscount: number
  billDiscount: number
  extraCharges: number
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  grandTotal: number
}

export interface Invoice {
  id?: ID
  docType: DocType
  number: string
  /** YYYY-MM-DD */
  date: string
  partyId?: ID
  partyName: string
  partyPhone?: string
  partyGstin?: string
  partyState?: string
  placeOfSupply?: string
  lines: InvoiceLine[]
  totalQty: number
  subTotal: number
  itemDiscount: number
  billDiscount: number
  extraCharges: number
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  grandTotal: number
  /** Kitna paisa mil gaya / de diya (payments ke through update hota hai) */
  paid: number
  status: DocStatus
  mode?: PayMode | 'credit'
  note?: string
  convertedFromId?: ID
  convertedToId?: ID
  cancelled?: boolean
  cancelReason?: string
  createdAt: number
  updatedAt: number
  createdBy?: string
}

export interface Payment {
  id?: ID
  kind: PayKind
  /** YYYY-MM-DD */
  date: string
  partyId?: ID
  partyName?: string
  invoiceId?: ID
  invoiceNumber?: string
  amount: number
  mode: PayMode
  /** UPI ref / cheque no. */
  ref?: string
  note?: string
  /** true = advance / on-account (kisi bill ke against nahi) */
  onAccount: boolean
  createdAt: number
  updatedAt: number
  createdBy?: string
}

export interface Expense {
  id?: ID
  date: string
  category: string
  amount: number
  mode: PayMode
  note?: string
  createdAt: number
  updatedAt: number
}

export interface DocSetting {
  id?: ID
  docType: DocType
  prefix: string
  nextNumber: number
  padding: number
  /** Ye counter kis financial year ka hai — FY badalne par 1 se shuru */
  fy?: string
}

export interface AppSetting {
  id?: ID
  key: string
  value: string
}

export interface User {
  id?: ID
  name: string
  role: Role
  /** SHA-256(pin + salt) — phone me hi rehta hai */
  pinHash: string
  active: boolean
  createdAt: number
}

export interface DateRange {
  from: string
  to: string
}
