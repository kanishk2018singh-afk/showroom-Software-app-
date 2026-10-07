/** CSV cell escaping — Excel-safe (quotes, comma, newline, semicolon) */
export function csvEscape(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? '' : String(value)
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
