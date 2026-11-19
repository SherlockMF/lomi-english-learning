import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createNeonClient } from '@neon/neon-js/supabase'
import { cloudConfig } from './config'

export type CloudClient = SupabaseClient | ReturnType<typeof createNeonClient>
let cloudClient: CloudClient | undefined

export function getCloudClient() {
  if (!cloudClient) {
    const config = cloudConfig()
    cloudClient = config.provider === 'neon'
      ? createNeonClient({ auth: { url: config.authUrl, allowAnonymous: false }, dataApi: { url: config.dataUrl } })
      : createClient(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  }
  return cloudClient
}

export async function getCloudAccessToken(client: CloudClient) {
  if ('getBetterAuthInstance' in client.auth) return client.auth.getJWTToken(false)
  const result = await client.auth.getSession()
  return result.error ? null : result.data.session?.access_token ?? null
}

export function requestCloudPasswordReset(client: CloudClient, email: string, redirectTo: string) {
  if ('getBetterAuthInstance' in client.auth) {
    return client.auth.getBetterAuthInstance().requestPasswordReset({ email, redirectTo })
  }
  return client.auth.resetPasswordForEmail(email, { redirectTo })
}

export function saveCloudPassword(client: CloudClient, password: string, recoveryToken: string | null) {
  if ('getBetterAuthInstance' in client.auth) {
    if (!recoveryToken) throw new Error('Missing password reset token')
    return client.auth.getBetterAuthInstance().resetPassword({ token: recoveryToken, newPassword: password })
  }
  return client.auth.updateUser({ password })
}
