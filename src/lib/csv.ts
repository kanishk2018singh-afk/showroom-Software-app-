/**
 * CSV — items import/export aur reports export.
 *
 * Android app ki purani CSV file bhi chalti hai, isliye column matching
 * heading ke naam se hoti hai (Hindi + English dono), aur number parsing
 * "₹1,234.50" jaisa gandha input bhi samajh leta hai.
 */
import type { Table } from './reports'
import { csvEscape } from './util-csv'
import type { Item } from './types'
import { r2 } from './calc'
import { nowMs } from './util'

/** CSV file ka content banao (BOM + CRLF — Excel me Hindi/₹ theek dikhe) */
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) lines.push(row.map((cell) => csvEscape(cell)).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function tableToCsv(table: Table): string {
  return toCsv(table.headers, table.rows)
}

/** CSV text → rows (quotes, commas, CRLF, ; delimiter — sab handle) */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r?\n/)[0] ?? ''
  const delim = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i += 1
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** "₹1,234.50" / "1234.5" / "" → number */
export function parseNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v ?? '').replace(/[₹,\s]/g, '').replace(/[^0-9.\-]/g, '')
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

const HEADER_MAP: Record<string, keyof Item> = {
  code: 'code', 'item code': 'code', 'article code': 'code', 'itemcode': 'code', 'कोड': 'code',
  name: 'name', 'item name': 'name', item: 'name', 'product name': 'name', 'particulars': 'name', 'नाम': 'name',
  barcode: 'barcode', 'bar code': 'barcode',
  brand: 'brand', company: 'brand',
  category: 'category', 'main category': 'category', group: 'category',
  subcategory: 'subCategory', 'sub category': 'subCategory', 'sub-category': 'subCategory',
  hsn: 'hsn', 'hsn code': 'hsn',
  unit: 'unit', uom: 'unit',
  mrp: 'mrp', 'm.r.p': 'mrp',
  discount: 'discountPct', 'discount %': 'discountPct', 'disc%': 'discountPct', 'discount percent': 'discountPct',
  gst: 'gstPct', 'gst %': 'gstPct', 'gst%': 'gstPct', 'tax': 'gstPct', 'gst rate': 'gstPct',
  purchase: 'purchaseRate', 'purchase rate': 'purchaseRate', 'purchase price': 'purchaseRate', cost: 'purchaseRate', 'cost price': 'purchaseRate',
  sale: 'salePrice', 'sale price': 'salePrice', 'selling price': 'salePrice', rate: 'salePrice', price: 'salePrice', mrp2: 'salePrice',
  stock: 'stock', qty: 'stock', quantity: 'stock', 'opening stock': 'stock', 'stock qty': 'stock',
  'low stock': 'lowStockAlert', 'low stock alert': 'lowStockAlert', 'alert qty': 'lowStockAlert', min: 'lowStockAlert',
}

export interface ImportResult {
  items: Item[]
  skipped: number
  errors: string[]
}

/** CSV rows → Item[] (header ke naam se mapping; missing field default) */
export function itemsFromCsv(text: string): ImportResult {
  const rows = parseCsv(text)
  if (!rows.length) return { items: [], skipped: 0, errors: ['File khaali hai'] }

  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '))
  const index: Partial<Record<keyof Item, number>> = {}
  headers.forEach((h, i) => {
    const key = HEADER_MAP[h]
    if (key && index[key] === undefined) index[key] = i
  })

  if (index.name === undefined && index.code === undefined) {
    return { items: [], skipped: rows.length - 1, errors: ['CSV me "Name" ya "Code" column hona chahiye'] }
  }

  const items: Item[] = []
  const errors: string[] = []
  let skipped = 0
  const t = nowMs()

  rows.slice(1).forEach((row, i) => {
    const get = (key: keyof Item): string => (index[key] !== undefined ? String(row[index[key]!] ?? '').trim() : '')
    const name = get('name') || get('code')
    if (!name) {
      skipped += 1
      return
    }
    const code = get('code') || `IMP${String(items.length + skipped + 1).padStart(3, '0')}`
    const gst = parseNumber(get('gstPct'))
    const item: Item = {
      code,
      name,
      barcode: get('barcode'),
      brand: get('brand'),
      category: get('category') || 'General',
      subCategory: get('subCategory'),
      hsn: get('hsn'),
      unit: get('unit') || 'pc',
      mrp: parseNumber(get('mrp')),
      discountPct: parseNumber(get('discountPct')),
      gstPct: [0, 5, 12, 18, 28].includes(gst) ? gst : 18,
      purchaseRate: parseNumber(get('purchaseRate')),
      salePrice: parseNumber(get('salePrice')) || parseNumber(get('mrp')),
      stock: parseNumber(get('stock')),
      lowStockAlert: parseNumber(get('lowStockAlert')) || 5,
      createdAt: t,
      updatedAt: t,
    }
    if (item.gstPct !== gst) errors.push(`Row ${i + 2}: GST ${gst}% sahi nahi — 18% lagaya gaya`)
    items.push(item)
  })

  return { items, skipped, errors }
}

/** Android/purane app ke liye item CSV template */
export function itemTemplateCsv(): string {
  return toCsv(
    ['Code', 'Name', 'Barcode', 'Brand', 'Category', 'SubCategory', 'HSN', 'Unit', 'MRP', 'Discount %', 'GST %', 'Purchase Rate', 'Sale Price', 'Stock', 'Low Stock Alert'],
    [
      ['S101', 'Steel Thali 12"', '8901234500011', 'Sunshine', 'Steel', 'Thali', '7323', 'pc', 399, 0, 18, 240, 349, 25, 5],
      ['S102', 'Cotton Towel', '', 'Local', 'Home', 'Towel', '6302', 'pc', 249, 5, 5, 120, 199, 40, 10],
    ],
  )
}

/** Items export (wahi column order jo import samajhta hai) */
export function itemsToCsv(items: Item[]): string {
  return toCsv(
    ['Code', 'Name', 'Barcode', 'Brand', 'Category', 'SubCategory', 'HSN', 'Unit', 'MRP', 'Discount %', 'GST %', 'Purchase Rate', 'Sale Price', 'Stock', 'Low Stock Alert', 'Margin'],
    items.map((i) => [
      i.code, i.name, i.barcode ?? '', i.brand ?? '', i.category ?? '', i.subCategory ?? '', i.hsn ?? '', i.unit,
      i.mrp, i.discountPct, i.gstPct, i.purchaseRate, i.salePrice, i.stock, i.lowStockAlert, r2(i.salePrice - i.purchaseRate),
    ]),
  )
}
