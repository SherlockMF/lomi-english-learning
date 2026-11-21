import { expect, it, vi } from 'vitest'
import { seedCloudWords, seedNeonWords } from './seedCloudWords.mjs'

const url = 'https://seed-project.supabase.co/'
const secret = 'sb_secret_test_placeholder'
const words = Array.from({ length: 401 }, (_, index) => ({ id: `seed-${index}`, expression: `word-${index}` }))

it('imports with only apikey authentication at the fixed shared-words REST endpoint', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 201 }))
  expect(await seedCloudWords({ url, secret, words, fetcher })).toBe(401)
  expect(fetcher).toHaveBeenCalledTimes(3)
  const calls = fetcher.mock.calls as unknown as Array<[string | URL, RequestInit]>
  expect(calls.map(([, init]) => JSON.parse(String(init.body)).length)).toEqual([200, 200, 1])
  for (const [input, init] of calls) {
    const headers = new Headers(init.headers)
    expect(headers.get('apikey')).toBe(secret)
    expect(headers.has('authorization')).toBe(false)
    expect(String(input)).toBe('https://seed-project.supabase.co/rest/v1/words?on_conflict=id')
    expect(init.method).toBe('POST')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('prefer')).toContain('resolution=merge-duplicates')
  }
  expect(JSON.parse(String(calls[0][1].body))[0]).toEqual({ id: words[0].id, data: words[0] })
})

it('stops after a failed batch without exposing response diagnostics or continuing uploads', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(new Response('sensitive-provider-error', { status: 403 }))
  await expect(seedCloudWords({ url, secret, words, fetcher })).rejects.toThrow('Shared word upload failed')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('upserts the same validated shared words into Neon in bounded parameterized batches', async () => {
  const query = vi.fn(async (_statement: string, _parameters: string[]) => [])
  expect(await seedNeonWords({ query, words })).toBe(401)
  expect(query.mock.calls.map(([, [rows]]) => JSON.parse(rows).length)).toEqual([200, 200, 1])
  expect(query.mock.calls[0][0]).toContain('jsonb_to_recordset($1::jsonb)')
  expect(query.mock.calls[0][0]).toContain('on conflict (id)')
  expect(query.mock.calls[0][0]).not.toContain(words[0].id)
})

it('leaves existing shared rows alone during the expansion import', async () => {
  const query = vi.fn(async (_statement: string, _parameters: string[]) => [])
  await seedNeonWords({ query, words: [{ id: 'v6-housing-test' }], insertOnly: true })
  expect(query.mock.calls[0][0]).toContain('on conflict (id) do nothing')
})
