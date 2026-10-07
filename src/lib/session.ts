/**
 * Login session (offline, device-level).
 * Session sirf sessionStorage me rehta hai — tab band hote hi khatam.
 */
import type { ShowroomDB } from './db'
import type { ID, Role } from './types'

const KEY = 'showroom:session'

export interface Session {
  userId: ID
  name: string
  role: Role
  at: number
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function saveSession(s: Session): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode me sessionStorage fail ho sakta hai — app chalti rahegi */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Kya login zaroori hai? (jab tak koi user na ho, app khuli rehti hai) */
export async function loginRequired(db: ShowroomDB): Promise<boolean> {
  const users = await db.users.filter((u) => u.active).toArray()
  if (!users.length) return false
  return !loadSession()
}
