import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createNeonClient } from '@neon/neon-js/supabase'
import { cloudConfig } from './config'

export type CloudClient = SupabaseClient | ReturnType<typeof createNeonClient>
export type CloudMembership = { plan: 'trial' | 'standard'; expires_at: string | null; trial_expired: boolean; voice_ms: number; credits: number }
export const MIN_CLOUD_PASSWORD_LENGTH = 8
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

function neonAuth(client: CloudClient) {
  if (!('getBetterAuthInstance' in client.auth)) throw new Error('Email registration requires Neon Auth')
  return client.auth.getBetterAuthInstance()
}

export function beginCloudRegistration(client: CloudClient, email: string, password: string) {
  return neonAuth(client).signUp.email({ email, password, name: email.split('@')[0] || 'Lomi 用户' })
}

export function verifyCloudRegistration(client: CloudClient, email: string, otp: string) {
  return neonAuth(client).emailOtp.verifyEmail({ email, otp })
}

export function resendCloudRegistrationCode(client: CloudClient, email: string) {
  return neonAuth(client).emailOtp.sendVerificationOtp({ email, type: 'email-verification' })
}

export async function readNeonMembership(client: CloudClient, signal?: AbortSignal) {
  const request = client.rpc('lomi_membership', {})
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  if (error || typeof data?.active !== 'boolean') throw new Error('无法验证账号权限，请检查网络后重试。')
  if (!data.active || data.plan === 'legacy') return { active: data.active as boolean, membership: null, needsVerification: data.needs_verification === true }
  if ((data.plan !== 'trial' && data.plan !== 'standard') || !Number.isSafeInteger(data.voice_ms) || !Number.isSafeInteger(data.credits)
    || typeof data.trial_expired !== 'boolean' || (data.expires_at !== null && typeof data.expires_at !== 'string')) {
    throw new Error('无法读取会员额度，请稍后重试。')
  }
  const membership: CloudMembership = {
    plan: data.plan, expires_at: data.expires_at, trial_expired: data.trial_expired, voice_ms: data.voice_ms, credits: data.credits,
  }
  return { active: true, membership, needsVerification: false }
}
