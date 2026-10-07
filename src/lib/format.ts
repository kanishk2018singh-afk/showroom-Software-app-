/** Formatting helpers — currency, date, Indian number-to-words. */

const INR = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 1234567.5 → "₹12,34,567.50" */
export function inr(n: number | undefined | null, withSymbol = true): string {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0
  const s = INR.format(Math.abs(v) < 0.005 ? 0 : v)
  return withSymbol ? `₹${s}` : s
}

/** Bina decimal — tiles/charts ke liye chhota number */
export function inrShort(n: number | undefined | null): string {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  if (abs >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)} Cr`
  if (abs >= 1_00_000) return `₹${(v / 1_00_000).toFixed(2)} L`
  if (abs >= 1_000) return `₹${Math.round(v).toLocaleString('en-IN')}`
  return `₹${INR.format(v)}`
}

export function num(n: number | undefined | null, digits = 2): string {
  const v = Number(n) || 0
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function qty(n: number | undefined | null): string {
  const v = Number(n) || 0
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)))
}

export const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/** Date → YYYY-MM-DD (local, timezone-safe) */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function today(): string {
  return isoDate(new Date())
}

export function parseISO(s: string): Date {
  const [y, m, d] = (s || today()).split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

/** YYYY-MM-DD → DD/MM/YYYY */
export function fmtDate(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return s
  return `${d}/${m}/${y}`
}

/** YYYY-MM-DD → "07 Oct 2026" */
export function fmtDateLong(s: string): string {
  const d = parseISO(s)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`
}

export function addDays(s: string, days: number): string {
  const d = parseISO(s)
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

/** Financial year label for a date — 2026-04-01 → "26-27" */
export function fyLabel(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? parseISO(d) : d
  const y = date.getFullYear()
  const start = date.getMonth() >= 3 ? y : y - 1
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`
}

/** FY ki start date (1 April) */
export function fyStart(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? parseISO(d) : d
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  return `${y}-04-01`
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = parseISO(fromISO).getTime()
  const b = parseISO(toISO).getTime()
  return Math.floor((b - a) / 86_400_000)
}

export function monthLabel(s: string): string {
  const d = parseISO(s)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ''}`
}

/** Indian system: crore / lakh / thousand */
function wholeWords(n: number): string {
  if (n === 0) return 'zero'
  const parts: string[] = []
  const crore = Math.floor(n / 1_00_00_000)
  n %= 1_00_00_000
  const lakh = Math.floor(n / 1_00_000)
  n %= 1_00_000
  const thousand = Math.floor(n / 1_000)
  n %= 1_000
  const hundred = Math.floor(n / 100)
  n %= 100
  if (crore) parts.push(`${wholeWords(crore)} crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} thousand`)
  if (hundred) parts.push(`${ONES[hundred]} hundred`)
  if (n) parts.push(twoDigits(n))
  return parts.join(' ')
}

/** Har shabd ka pehla akshar bada — invoice par professional dikhta hai */
function titleCase(text: string): string {
  return text
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** 123456.5 → "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees And Fifty Paise Only" */
export function amountInWords(amount: number): string {
  const v = Math.abs(Number(amount) || 0)
  const rupees = Math.floor(v)
  const paise = Math.round((v - rupees) * 100)
  let out = `${titleCase(wholeWords(rupees))} Rupees`
  if (paise > 0) out += ` And ${titleCase(twoDigits(paise))} Paise`
  return `${out} Only`
}

export function initials(name: string): string {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function phoneDigits(phone?: string): string {
  return (phone || '').replace(/\D/g, '')
}

/** WhatsApp link — 10 digit number par bhi chal jata hai (91 default) */
export function waLink(phone: string | undefined, text: string): string {
  let p = phoneDigits(phone)
  if (p.length === 10) p = `91${p}`
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`
}

export function safeFile(name: string): string {
  return name.replace(/[^\w\d.-]+/g, '_').replace(/_+/g, '_')
}
