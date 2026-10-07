/**
 * UI primitives — ek jagah sab chhote building blocks.
 * Design: mobile-first (dukaandaar ka phone), bade touch targets, Hinglish labels.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'

/* ----------------------------- Button ----------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-indigo-700 text-white active:bg-indigo-800 disabled:bg-indigo-300',
  secondary: 'bg-white text-slate-800 border border-slate-300 active:bg-slate-100',
  ghost: 'bg-transparent text-indigo-700 active:bg-indigo-50',
  danger: 'bg-rose-600 text-white active:bg-rose-700',
  success: 'bg-emerald-600 text-white active:bg-emerald-700',
  warning: 'bg-amber-500 text-white active:bg-amber-600',
}

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-5 py-3.5 text-base rounded-2xl',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition disabled:opacity-60 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {children}
    </button>
  )
}

export function IconButton({ className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 active:bg-slate-100 ${className}`}>
      {children}
    </button>
  )
}

/* ----------------------------- Card / layout ----------------------------- */

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-2xl bg-white p-4 card-shadow ${onClick ? 'active:bg-slate-50' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-sm font-bold text-slate-700">{children}</h2>
      {right}
    </div>
  )
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' | 'indigo' | 'blue' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-rose-100 text-rose-700',
    amber: 'bg-amber-100 text-amber-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    blue: 'bg-sky-100 text-sky-700',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>
}

export function EmptyState({ icon = '📄', title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <div className="font-semibold text-slate-700">{title}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
      {action}
    </div>
  )
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'slate',
  onClick,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'slate' | 'green' | 'red' | 'amber' | 'indigo'
  onClick?: () => void
}) {
  const tones: Record<string, string> = {
    slate: 'bg-white text-slate-900',
    green: 'bg-emerald-50 text-emerald-900',
    red: 'bg-rose-50 text-rose-900',
    amber: 'bg-amber-50 text-amber-900',
    indigo: 'bg-indigo-50 text-indigo-900',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl p-3 text-left card-shadow ${tones[tone]} ${onClick ? 'active:scale-[0.99]' : ''}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-extrabold leading-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] opacity-70">{sub}</div>}
    </button>
  )
}

/* ----------------------------- Form fields ----------------------------- */

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  const id = useId()
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}

const inputBase =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100'

export function Input({ className = '', ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input {...rest} ref={ref} className={`${inputBase} ${className}`} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${inputBase} min-h-[72px] ${className}`} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${inputBase} pr-8 ${className}`}>
      {children}
    </select>
  )
}

/** Chips — doc type / payment mode select karne ke liye (tap-friendly) */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: Array<{ value: T; label: string; icon?: string }>
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-full border font-semibold transition ${
            size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
          } ${
            value === o.value
              ? 'border-indigo-700 bg-indigo-700 text-white'
              : 'border-slate-300 bg-white text-slate-600 active:bg-slate-100'
          }`}
        >
          {o.icon ? `${o.icon} ` : ''}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------- Modal / Sheet ----------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`animate-in flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <IconButton onClick={onClose} aria-label="Band karein">
            ✕
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/* ----------------------------- Toast ----------------------------- */

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
}

interface ToastCtx {
  toast: (message: string, tone?: Toast['tone']) => void
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])

  const toast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, message, tone }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), tone === 'error' ? 5000 : 2800)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-in pointer-events-auto max-w-md rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-lg ${
              t.tone === 'error' ? 'bg-rose-600' : t.tone === 'success' ? 'bg-emerald-600' : 'bg-slate-800'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastCtx {
  return useContext(ToastContext)
}

/* ----------------------------- Confirm ----------------------------- */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Haan, kar do',
  tone = 'danger',
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  tone?: Variant
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Nahi
          </Button>
          <Button variant={tone} className="flex-1" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {message && <p className="text-sm text-slate-600">{message}</p>}
      {children}
    </Modal>
  )
}

/* ----------------------------- Misc ----------------------------- */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label ?? 'Ruko zara…'}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Khojein…'}
        className={`${inputBase} pl-9`}
        type="search"
        inputMode="search"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-slate-400"
          aria-label="Saaf karein"
        >
          ✕
        </button>
      )}
    </div>
  )
}

/** Progress line — reports me share dikhane ke liye */
export function Bar({ value, max, tone = 'indigo' }: { value: number; max: number; tone?: 'indigo' | 'green' | 'red' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const tones: Record<string, string> = { indigo: 'bg-indigo-500', green: 'bg-emerald-500', red: 'bg-rose-500' }
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
