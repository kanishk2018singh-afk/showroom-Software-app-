/**
 * Cloud — Firebase Auth + Firestore, REST se (koi SDK nahi).
 *
 * Kyun SDK nahi? Firebase SDK bundle ~150 KB+ jodta hai aur offline-first app me
 * uska poora realtime machinery bekaar hai. Hume sirf 4 call chahiye:
 *   signup, signin, token refresh, aur ek document ka get/set.
 *
 * Setup: Settings → Cloud account me apna firebaseConfig paste karein
 * (README me 5-step guide hai).
 */

export interface CloudConfig {
  apiKey: string
  authDomain?: string
  projectId: string
  appId?: string
  /** Optional — Google login ke liye (Google Cloud se OAuth Web client ID) */
  googleClientId?: string
}

export interface CloudSession {
  uid: string
  email: string
  idToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
}

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1'
const TOKEN_API = 'https://securetoken.googleapis.com/v1/token'
const FIRESTORE = 'https://firestore.googleapis.com/v1'

/** Firebase config paste se parse — JSON, ya poora JS snippet dono chalta hai */
export function parseFirebaseConfig(text: string): CloudConfig {
  const trimmed = text.trim()
  // 1) JSON try
  try {
    const json = JSON.parse(trimmed.replace(/^const\s+\w+\s*=\s*/, '').replace(/;?\s*$/, '')) as CloudConfig
    if (json?.apiKey && json?.projectId) return normalize(json)
  } catch {
    /* aage regex se nikalenge */
  }
  // 2) "apiKey: '...'" style
  const pick = (key: string): string | undefined =>
    trimmed.match(new RegExp(`${key}\\s*[:=]\\s*['"\`]([^'"\`]+)['"\`]`))?.[1]
  const cfg: CloudConfig = {
    apiKey: pick('apiKey') ?? '',
    authDomain: pick('authDomain'),
    projectId: pick('projectId') ?? '',
    appId: pick('appId'),
    googleClientId: pick('googleClientId') ?? pick('clientId'),
  }
  if (!cfg.apiKey || !cfg.projectId) {
    throw new Error('firebaseConfig me apiKey aur projectId hona chahiye')
  }
  return normalize(cfg)
}

function normalize(cfg: CloudConfig): CloudConfig {
  const projectId = cfg.projectId.trim()
  return {
    apiKey: cfg.apiKey.trim(),
    projectId,
    appId: cfg.appId?.trim(),
    authDomain: cfg.authDomain?.trim() || `${projectId}.firebaseapp.com`,
    googleClientId: cfg.googleClientId?.trim(),
  }
}

interface RawAuthResult {
  idToken: string
  email?: string
  refreshToken: string
  localId: string
  expiresIn: string
}

async function authRequest(path: string, body: unknown, apiKey: string): Promise<RawAuthResult> {
  const res = await fetch(`${IDENTITY}/${path}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = (json.error as { message?: string })?.message ?? `HTTP ${res.status}`
    throw new Error(friendlyAuthError(err))
  }
  return json as unknown as RawAuthResult
}

function friendlyAuthError(code: string): string {
  const map: Record<string, string> = {
    EMAIL_EXISTS: 'Ye email pehle se registered hai — login karein',
    EMAIL_NOT_FOUND: 'Is email ka account nahi mila',
    INVALID_PASSWORD: 'Password galat hai',
    INVALID_LOGIN_CREDENTIALS: 'Email ya password galat hai',
    WEAK_PASSWORD: 'Password kam se kam 6 character ka rakhein',
    INVALID_EMAIL: 'Email sahi format me likhein',
    OPERATION_NOT_ALLOWED: 'Firebase me Email/Password login enable nahi hai',
    API_KEY_INVALID: 'apiKey galat hai — firebaseConfig dobara check karein',
    CONFIGURATION_NOT_FOUND: 'Firebase project me Authentication setup nahi hua',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Bahut zyada koshish — thodi der baad try karein',
    USER_DISABLED: 'Ye account band kar diya gaya hai',
  }
  return map[code] ?? code.replace(/_/g, ' ').toLowerCase()
}

function toSession(r: RawAuthResult, email?: string): CloudSession {
  return {
    uid: r.localId,
    email: r.email ?? email ?? '',
    idToken: r.idToken,
    refreshToken: r.refreshToken,
    expiresAt: Date.now() + (Number(r.expiresIn) || 3600) * 1000,
  }
}

export async function signUpEmail(cfg: CloudConfig, email: string, password: string): Promise<CloudSession> {
  const r = await authRequest('accounts:signUp', { email, password, returnSecureToken: true }, cfg.apiKey)
  return toSession(r, email)
}

export async function signInEmail(cfg: CloudConfig, email: string, password: string): Promise<CloudSession> {
  const r = await authRequest('accounts:signInWithPassword', { email, password, returnSecureToken: true }, cfg.apiKey)
  return toSession(r, email)
}

/** Anonymous login — bina email wale dukaandaar ke liye quick start */
export async function signInAnon(cfg: CloudConfig): Promise<CloudSession> {
  const r = await authRequest('accounts:signUp', { returnSecureToken: true }, cfg.apiKey)
  return toSession(r, 'guest')
}

/** Google ID token (GIS se mila) ko Firebase session me badlo */
export async function signInWithGoogleToken(cfg: CloudConfig, googleIdToken: string): Promise<CloudSession> {
  const r = await authRequest(
    'accounts:signInWithIdp',
    {
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: location.origin,
      returnIdpCredential: true,
      returnSecureToken: true,
    },
    cfg.apiKey,
  )
  return toSession(r)
}

export async function refreshSession(cfg: CloudConfig, session: CloudSession): Promise<CloudSession> {
  const res = await fetch(`${TOKEN_API}?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, string>
  if (!res.ok) throw new Error(json.error ? `Session expire — dobara login karein (${json.error})` : 'Session refresh fail')
  return {
    uid: json.user_id,
    email: session.email,
    idToken: json.id_token,
    refreshToken: json.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  }
}

/** Kaam ke liye tayyar session (expire hone par khud refresh) */
export async function ensureFresh(cfg: CloudConfig, session: CloudSession): Promise<CloudSession> {
  if (session.expiresAt - Date.now() > 60_000) return session
  return refreshSession(cfg, session)
}

/* ------------------------- Firestore (REST) ------------------------- */

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  return { stringValue: String(value) }
}

function fromFirestoreValue(v: FirestoreValue): unknown {
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  return null
}

/** Ek doc me pura snapshot bhejo — path: showroomUsers/{uid}/companies/{companyId} */
export async function pushSnapshot(cfg: CloudConfig, session: CloudSession, companyId: string, snapshot: unknown, rev: number): Promise<void> {
  const path = `projects/${cfg.projectId}/databases/(default)/documents/showroomUsers/${session.uid}/companies/${companyId}`
  const body = {
    fields: {
      rev: toFirestoreValue(rev),
      updatedAt: toFirestoreValue(Date.now()),
      payload: toFirestoreValue(JSON.stringify(snapshot)),
    },
  }
  const res = await fetch(`${FIRESTORE}/${path}?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } }
    throw new Error(firestoreError(json.error?.status ?? '', json.error?.message ?? `HTTP ${res.status}`))
  }
}

export interface RemoteSnapshot {
  rev: number
  updatedAt: number
  payload: unknown
}

export async function pullSnapshot(cfg: CloudConfig, session: CloudSession, companyId: string): Promise<RemoteSnapshot | null> {
  const path = `projects/${cfg.projectId}/databases/(default)/documents/showroomUsers/${session.uid}/companies/${companyId}`
  const res = await fetch(`${FIRESTORE}/${path}?key=${encodeURIComponent(cfg.apiKey)}`, {
    headers: { Authorization: `Bearer ${session.idToken}` },
  })
  if (res.status === 404) return null
  const json = (await res.json().catch(() => ({}))) as {
    fields?: Record<string, FirestoreValue>
    error?: { status?: string; message?: string }
  }
  if (!res.ok) throw new Error(firestoreError(json.error?.status ?? '', json.error?.message ?? `HTTP ${res.status}`))
  const fields = json.fields ?? {}
  const payloadText = fields.payload ? String(fromFirestoreValue(fields.payload)) : ''
  if (!payloadText) return { rev: Number(fromFirestoreValue(fields.rev ?? { integerValue: '0' })) || 0, updatedAt: 0, payload: null }
  let payload: unknown = null
  try {
    payload = JSON.parse(payloadText)
  } catch {
    payload = null
  }
  return {
    rev: Number(fromFirestoreValue(fields.rev ?? { integerValue: '0' })) || 0,
    updatedAt: Number(fromFirestoreValue(fields.updatedAt ?? { integerValue: '0' })) || 0,
    payload,
  }
}

/** Company list cloud se (doosre phone me login karte hi sab companies dikh jayein) */
export async function listRemoteCompanies(cfg: CloudConfig, session: CloudSession): Promise<string[]> {
  const path = `projects/${cfg.projectId}/databases/(default)/documents/showroomUsers/${session.uid}/companies`
  const res = await fetch(`${FIRESTORE}/${path}?key=${encodeURIComponent(cfg.apiKey)}&pageSize=100`, {
    headers: { Authorization: `Bearer ${session.idToken}` },
  })
  const json = (await res.json().catch(() => ({}))) as { documents?: Array<{ name: string }>; error?: { status?: string; message?: string } }
  if (!res.ok) throw new Error(firestoreError(json.error?.status ?? '', json.error?.message ?? `HTTP ${res.status}`))
  return (json.documents ?? []).map((d) => d.name.split('/').pop() ?? '').filter(Boolean)
}

function firestoreError(status: string, message: string): string {
  if (status === 'PERMISSION_DENIED') {
    return 'Permission denied — Firestore Rules publish karein (README me rules diye hain)'
  }
  if (status === 'UNAUTHENTICATED') return 'Login expire ho gaya — dobara sign in karein'
  if (status === 'NOT_FOUND') return 'Firestore database nahi mila — console me database banayein'
  if (status === 'FAILED_PRECONDITION') return 'Firestore abhi ready nahi — console me database banayein (asia-south1)'
  return message
}

/* ------------------------- Google login (GIS) ------------------------- */

const GIS_SRC = 'https://accounts.google.com/gsi/client'

/** Google Identity Services load (optional — sirf tab jab Google login use karna ho) */
export async function loadGoogleScript(): Promise<void> {
  if (document.querySelector(`script[src="${GIS_SRC}"]`)) return
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Google script load nahi hui (internet check karein)'))
    document.head.appendChild(s)
  })
}

export interface GoogleAccounts {
  accounts: { id: { initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void; prompt: () => void } }
}

/** Google button se ID token lo → Firebase session */
export async function googleSignIn(cfg: CloudConfig): Promise<CloudSession> {
  if (!cfg.googleClientId) throw new Error('Google login ke liye googleClientId set karein (Settings → Cloud)')
  await loadGoogleScript()
  const g = (window as unknown as { google?: GoogleAccounts }).google
  if (!g) throw new Error('Google login sirf web browser me chalta hai')
  const credential = await new Promise<string>((resolve, reject) => {
    let settled = false
    g.accounts.id.initialize({
      client_id: cfg.googleClientId as string,
      callback: (r) => {
        if (settled) return
        settled = true
        r.credential ? resolve(r.credential) : reject(new Error('Google ne credential nahi diya'))
      },
    })
    g.accounts.id.prompt()
    setTimeout(() => {
      if (!settled) reject(new Error('Google login cancel ho gaya (ya popup block hua)'))
    }, 60_000)
  })
  return signInWithGoogleToken(cfg, credential)
}
