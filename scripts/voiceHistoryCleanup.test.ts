import { expect, it, vi } from 'vitest'
import { cleanupVoiceHistory } from './voiceHistoryCleanup.mjs'

const user = '00000000-0000-0000-0000-000000000001'
const id = '10000000-0000-0000-0000-000000000001'
it('deletes through Storage API only under the authenticated user and acknowledges after removal', async () => {
  const calls: { url: string; body: any; method: string }[] = []
  let listed = false
  const call = vi.fn(async (url: URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null, method: init.method ?? 'GET' })
    if (String(url).includes('/object/list/')) { const rows = listed ? [] : [{ name: `${'a'.repeat(64)}.wav` }]; listed = true; return Response.json(rows) }
    if (String(url).includes('/object/')) return Response.json([])
    if (init.method === 'PATCH') return new Response(null, { status: 204 })
    return Response.json([{ id }])
  })
  await cleanupVoiceHistory({ userId: user, supabase: new URL('https://test.supabase.co'), secret: 'test-secret', call })
  const remove = calls.find(value => value.method === 'DELETE')!
  expect(remove.body.prefixes).toEqual([`${user}/${id}/${'a'.repeat(64)}.wav`])
  expect(calls.at(-1)?.method).toBe('PATCH')
  expect(calls[0].url).toContain(`user_id=eq.${user}`)
})
it('keeps cleanup pending if Storage removal fails', async () => {
  const call = vi.fn(async (url: URL, init: RequestInit = {}) => {
    if (init.method === 'DELETE') return new Response('', { status: 503 })
    return Response.json(String(url).includes('/object/list/') ? [{ name: `${'a'.repeat(64)}.wav` }] : [{ id }])
  })
  await expect(cleanupVoiceHistory({ userId: user, supabase: new URL('https://test.supabase.co'), secret: 'test-secret', call })).rejects.toThrow()
  expect(call.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
})
