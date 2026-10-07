/** Chhote helpers — ids, time, misc. (db.ts ke saath circular import se bachne ke liye alag file) */

export function nowMs(): number {
  return Date.now()
}

let counter = 0
/** Collision-safe local id: time + counter + random */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1000
  const rand = Math.floor(Math.random() * 1e6).toString(36)
  return `${prefix}${prefix ? '_' : ''}${Date.now().toString(36)}${counter.toString(36)}${rand}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Debounce — search box / autosave ke liye */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms = 300): T & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined
  const wrapped = ((...args: never[]) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }) as T & { cancel: () => void }
  wrapped.cancel = () => {
    if (t) clearTimeout(t)
  }
  return wrapped
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

/** Chhota beep — barcode scan confirm (Web Audio, koi file nahi) */
export function beep(freq = 880, ms = 90): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.value = 0.06
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + ms / 1000)
    setTimeout(() => void ctx.close(), ms + 120)
  } catch {
    /* audio optional hai */
  }
}

export function vibrate(pattern: number | number[] = 25): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* optional */
  }
}
