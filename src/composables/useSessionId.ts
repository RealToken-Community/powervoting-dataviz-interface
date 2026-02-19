const STORAGE_KEY = 'powervoting_session_id'

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Session ID for generation/upload isolation: one workspace per browser (localStorage).
 * Used as X-Session-Id header so the server isolates balance-calculator clone and generated files per user.
 * Persistance : le session ID reste dans le navigateur après redémarrage du serveur,
 * donc chaque utilisateur retrouve sa session tant qu'il utilise le même navigateur / même origine.
 */
export function useSessionId(): string {
  if (typeof window === 'undefined') return generateUUID()
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id || !UUID_REGEX.test(id)) {
    id = generateUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

/**
 * Adopter une session suggérée par le serveur (ex: récupération après redémarrage quand un seul workspace existe).
 */
export function setSessionId(id: string): void {
  if (typeof window === 'undefined') return
  if (UUID_REGEX.test(id)) {
    localStorage.setItem(STORAGE_KEY, id)
  }
}

/**
 * Headers to add to fetch requests that require session isolation (Generate + Upload generated files).
 */
export function sessionHeaders(): Record<string, string> {
  return { 'X-Session-Id': useSessionId() }
}

/**
 * Options par défaut pour les fetch API : envoi des cookies (session serveur) + header X-Session-Id.
 * Utiliser avec : fetch(url, { ...apiOptions(), method: 'POST', body: ... })
 */
export function apiOptions(): RequestInit {
  return {
    credentials: 'include',
    headers: sessionHeaders(),
  }
}
