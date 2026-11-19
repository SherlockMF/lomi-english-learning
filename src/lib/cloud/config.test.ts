import { afterEach, expect, it, vi } from 'vitest'
import { cloudConfig, isCloudEnabled } from './config'

afterEach(() => vi.unstubAllEnvs())

it('selects the Neon backend when both public endpoints are set', () => {
  vi.stubEnv('VITE_NEON_AUTH_URL', 'https://auth.example.test/neondb/auth')
  vi.stubEnv('VITE_NEON_DATA_URL', 'https://data.example.test/neondb/rest/v1')
  expect(isCloudEnabled()).toBe(true)
  expect(cloudConfig()).toEqual({
    provider: 'neon',
    authUrl: 'https://auth.example.test/neondb/auth',
    dataUrl: 'https://data.example.test/neondb/rest/v1',
  })
})

it('rejects incomplete Neon configuration rather than opening another backend', () => {
  vi.stubEnv('VITE_NEON_AUTH_URL', 'https://auth.example.test/neondb/auth')
  vi.stubEnv('VITE_NEON_DATA_URL', '')
  expect(() => cloudConfig()).toThrow('云端登录配置不完整')
})
