export function isCloudEnabled() {
  return Boolean(import.meta.env.VITE_NEON_AUTH_URL || import.meta.env.VITE_NEON_DATA_URL
    || import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
}

function cloudUrl(value: string) {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' && !(import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('云端登录地址必须使用 HTTPS。')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('云端登录地址格式不正确。')
  return parsed
}

export function cloudConfig() {
  const authUrl = import.meta.env.VITE_NEON_AUTH_URL?.trim()
  const dataUrl = import.meta.env.VITE_NEON_DATA_URL?.trim()
  if (authUrl || dataUrl) {
    if (!authUrl || !dataUrl) throw new Error('云端登录配置不完整，请联系管理员。')
    return { provider: 'neon' as const, authUrl: cloudUrl(authUrl).href, dataUrl: cloudUrl(dataUrl).href }
  }
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key) throw new Error('云端登录配置不完整，请联系管理员。')
  return { provider: 'supabase' as const, url: cloudUrl(url).origin, key }
}
