/**
 * Chhote SVG charts — koi chart library nahi (bundle chhota, offline-safe).
 * Dukaan ke reports ke liye itna kaafi hai.
 */
import { useState } from 'react'
import { inrShort } from '../lib/format'

export interface Point {
  label: string
  value: number
  secondary?: number
}

/** Din/Mahine ki sale ka bar chart — tap karke value dekh sakte hain */
export function BarChart({ data, height = 140, secondaryLabel = 'Purchase' }: { data: Point[]; height?: number; secondaryLabel?: string }) {
  const [active, setActive] = useState<number | null>(null)
  if (!data.length) return <div className="py-6 text-center text-xs text-slate-400">Koi data nahi</div>

  const max = Math.max(...data.map((d) => Math.max(d.value, d.secondary ?? 0)), 1)
  const shown = data.slice(-14)

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {shown.map((d, i) => (
          <button
            key={`${d.label}-${i}`}
            type="button"
            onMouseEnter={() => setActive(i)}
            onClick={() => setActive(active === i ? null : i)}
            className="flex h-full flex-1 flex-col items-center justify-end gap-0.5"
          >
            {d.secondary !== undefined && d.secondary > 0 && (
              <div className="w-full rounded-t bg-amber-300" style={{ height: `${(d.secondary / max) * 55}%` }} title={`${secondaryLabel}: ${inrShort(d.secondary)}`} />
            )}
            <div className="w-full rounded-t bg-indigo-500" style={{ height: `${(d.value / max) * 75}%` }} title={`Sale: ${inrShort(d.value)}`} />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{shown[0]?.label}</span>
        <span>{shown[shown.length - 1]?.label}</span>
      </div>
      {active !== null && shown[active] && (
        <div className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
          <b>{shown[active].label}</b> — Sale: {inrShort(shown[active].value)}
          {shown[active].secondary !== undefined && ` · ${secondaryLabel}: ${inrShort(shown[active].secondary ?? 0)}`}
        </div>
      )}
    </div>
  )
}

/** Category-wise kharcha / items — horizontal bars */
export function HBars({ data, tone = 'indigo', onClick }: { data: Point[]; tone?: 'indigo' | 'green' | 'amber'; onClick?: (index: number) => void }) {
  if (!data.length) return <div className="py-4 text-center text-xs text-slate-400">Koi data nahi</div>
  const max = Math.max(...data.map((d) => d.value), 1)
  const tones: Record<string, string> = { indigo: 'bg-indigo-500', green: 'bg-emerald-500', amber: 'bg-amber-500' }
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <button key={`${d.label}-${i}`} type="button" className="block w-full text-left" onClick={() => onClick?.(i)}>
          <div className="flex items-center justify-between text-xs">
            <span className="truncate pr-2 font-medium text-slate-700">{d.label}</span>
            <span className="shrink-0 font-semibold text-slate-900">{inrShort(d.value)}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </button>
      ))}
    </div>
  )
}

/** Donut — payment mode / doc type share */
export function Donut({ data, size = 132, centerLabel }: { data: Point[]; size?: number; centerLabel?: string }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0)
  if (total <= 0) return <div className="py-4 text-center text-xs text-slate-400">Koi data nahi</div>
  const colors = ['#4338ca', '#059669', '#f59e0b', '#0284c7', '#db2777', '#64748b', '#7c3aed']
  const radius = size / 2 - 12
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((d, i) => {
            const value = Math.max(0, d.value)
            const len = (value / total) * circumference
            const circle = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth={16}
                strokeDasharray={`${len} ${circumference - len}`}
                strokeDashoffset={-offset}
              />
            )
            offset += len
            return circle
          })}
        </g>
        {centerLabel && (
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-slate-700 text-[11px] font-bold">
            {centerLabel}
          </text>
        )}
      </svg>
      <div className="flex-1 space-y-1">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[i % colors.length] }} />
            <span className="flex-1 truncate text-slate-600">{d.label}</span>
            <span className="font-semibold text-slate-800">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
