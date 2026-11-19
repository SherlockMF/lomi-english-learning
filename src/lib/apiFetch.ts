let tokenProvider: (() => Promise<string | null>) | null = null
export const MEMBERSHIP_USAGE_CHANGED = 'recall-membership-usage-changed'

export function setApiTokenProvider(provider: typeof tokenProvider) {
  tokenProvider = provider
}

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const provider = tokenProvider
  if (!provider) return fetch(path, options)
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('仅允许同源 API 请求。')
  const token = await provider()
  if (!token || tokenProvider !== provider) throw new Error('登录已失效，请重新登录。')
  const headers = new Headers(options?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const metered = options?.method?.toUpperCase() === 'POST' && (path === '/api/deepseek/v1/chat/completions'
    || /^\/api\/voice\/messages\/[^/]+\/turns$/.test(path))
  if (!metered) return fetch(path, { ...options, headers })
  try {
    return await fetch(path, { ...options, headers })
  } finally {
    // Some failures can still consume an allowance. Read the server balance again.
    if (tokenProvider === provider && typeof window !== 'undefined') window.dispatchEvent(new Event(MEMBERSHIP_USAGE_CHANGED))
  }
}
