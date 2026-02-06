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

/**
 * Session ID for generation/upload isolation: one workspace per browser (localStorage).
 * Used as X-Session-Id header so the server isolates balance-calculator clone and generated files per user.
 */
export function useSessionId(): string {
  if (typeof window === 'undefined') return generateUUID()
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    id = generateUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

/**
 * Headers to add to fetch requests that require session isolation (Generate + Upload generated files).
 */
export function sessionHeaders(): Record<string, string> {
  return { 'X-Session-Id': useSessionId() }
}
