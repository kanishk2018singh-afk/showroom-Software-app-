/**
 * Print & share — A4 invoice ya 80mm thermal, aur bill ki image WhatsApp ke liye.
 *
 * Print ke waqt hum alag "print-root" me document render karte hain aur
 * body par `printing` class lagate hain: CSS poori app ko hide karke sirf
 * invoice dikhata hai (isliye print me navigation/buttons kabhi nahi aate).
 */
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import html2canvas from 'html2canvas-pro'
import { InvoicePaper } from '../components/InvoicePaper'
import type { Business, Invoice } from './types'

export type PrintMode = 'a4' | 'thermal'

export interface PrintJob {
  invoice: Invoice
  business: Business
  mode: PrintMode
  copyLabel?: string
}

let activeRoot: Root | null = null
let cleanupTimer: ReturnType<typeof setTimeout> | undefined

export function printDoc(job: PrintJob): void {
  const host = document.getElementById('print-root')
  if (!host) {
    window.print()
    return
  }
  // pehle ka print saaf karo
  if (activeRoot) {
    activeRoot.unmount()
    activeRoot = null
  }
  host.innerHTML = ''
  activeRoot = createRoot(host)
  flushSync(() => {
    activeRoot!.render(<InvoicePaper invoice={job.invoice} business={job.business} mode={job.mode} copyLabel={job.copyLabel} />)
  })

  document.body.classList.add('printing')
  const cleanup = () => {
    document.body.classList.remove('printing')
    window.removeEventListener('afterprint', cleanup)
    if (cleanupTimer) clearTimeout(cleanupTimer)
    if (activeRoot) {
      activeRoot.unmount()
      activeRoot = null
    }
    host.innerHTML = ''
  }
  window.addEventListener('afterprint', cleanup)
  // Safari/iOS me afterprint nahi aata — fallback timer (print dialog khulne ke baad)
  cleanupTimer = setTimeout(cleanup, 60_000)

  setTimeout(() => {
    try {
      window.print()
    } catch {
      cleanup()
    }
  }, 60)
}

/** Invoice node ko PNG image me badlo (html2canvas-pro — Tailwind v4 ke oklch colors support karta hai) */
export async function invoiceImage(invoice: Invoice, business: Business, mode: PrintMode = 'a4'): Promise<Blob> {
  const cr = createRoot
  const fs = flushSync

  const holder = document.createElement('div')
  holder.style.position = 'fixed'
  holder.style.left = '-10000px'
  holder.style.top = '0'
  holder.style.background = '#ffffff'
  document.body.appendChild(holder)

  const root = cr(holder)
  fs(() => {
    root.render(<InvoicePaper invoice={invoice} business={business} mode={mode} />)
  })
  await new Promise((r) => requestAnimationFrame(r))

  try {
    const node = holder.firstElementChild as HTMLElement | null
    const target = node ?? holder
    const canvas = await html2canvas(target, { backgroundColor: '#ffffff', scale: 2, useCORS: true })
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image ban nahi payi'))), 'image/png', 0.95)
    })
    return blob
  } finally {
    root.unmount()
    holder.remove()
  }
}

/** Image share — jahan Web Share API ho (phone) wahan share sheet, warna download */
export async function shareInvoiceImage(invoice: Invoice, business: Business, mode: PrintMode = 'a4'): Promise<'shared' | 'downloaded'> {
  const blob = await invoiceImage(invoice, business, mode)
  const file = new File([blob], `${invoice.number.replace(/[^\w-]+/g, '_')}.png`, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: `${invoice.number}`, text: `${business.name} — ${invoice.number}` })
    return 'shared'
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded'
}
