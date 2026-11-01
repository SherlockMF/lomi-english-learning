import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { createProductionServer } from './productionServer.mjs'

const servers: Server[] = []
const roots: string[] = []
const sockets: WebSocketServer[] = []
afterEach(async () => {
  for (const provider of sockets.splice(0)) { for (const client of provider.clients) client.terminate(); provider.close() }
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})
async function listen(server: Server) {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('address')
  return `http://127.0.0.1:${address.port}`
}
async function fixture({ active = true, allowed = true, quotaError = false, voice = false, quotaGate = Promise.resolve() } = {}) {
  const calls: { path: string; auth?: string; apikey?: string; body?: Record<string, unknown> }[] = []
  const targets: { url: string; headers?: HeadersInit }[] = []
  let quotaStartedResolve!: () => void
  const quotaStarted = new Promise<void>(resolve => { quotaStartedResolve = resolve })
  const upstream = await listen(createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    calls.push({ path: req.url!, auth: req.headers.authorization, apikey: req.headers.apikey as string | undefined, body: raw ? JSON.parse(raw) : undefined })
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/auth/v1/user') { res.writeHead(['Bearer good', 'Bearer other'].includes(req.headers.authorization!) ? 200 : 401); res.end(JSON.stringify({ id: req.headers.authorization === 'Bearer other' ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001' })); return }
    if (req.url?.startsWith('/rest/v1/app_memberships')) { res.end(JSON.stringify([{ active }])); return }
    if (req.url === '/rest/v1/rpc/reserve_usage') { quotaStartedResolve(); await quotaGate; res.writeHead(req.headers.authorization === 'Bearer sb_secret_test_private' ? 401 : quotaError ? 500 : 200); res.end(JSON.stringify({ allowed, remaining: 1 })); return }
    res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
  }))
  const root = mkdtempSync(join(tmpdir(), 'production-test-')); roots.push(root)
  writeFileSync(join(root, 'index.html'), '<html>app</html>')
  const env = { APP_ORIGIN: 'https://english.lomivex.top', VITE_SUPABASE_URL: upstream, VITE_SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'sb_secret_test_private', DEEPSEEK_API_KEY: 'provider-secret', DASHSCOPE_API_KEY: 'voice-secret', DASHSCOPE_WORKSPACE_ID: 'workspace' }
  const request: typeof fetch = (input, init) => {
    if (String(input).startsWith('https://')) { targets.push({ url: String(input), headers: init?.headers }); return fetch(`${upstream}/provider`, init) }
    return fetch(input, init)
  }
  let messageConnect
  if (voice) {
    const provider = new WebSocketServer({ host: '127.0.0.1', port: 0 }); sockets.push(provider)
    await new Promise<void>(resolve => provider.once('listening', resolve))
    provider.on('connection', ws => {
      const send = (value: unknown) => ws.send(JSON.stringify(value))
      send({ type: 'session.created' })
      ws.on('message', raw => {
        const value = JSON.parse(raw.toString())
        if (value.type === 'session.update') send({ type: 'session.updated' })
        if (value.type === 'input_audio_buffer.commit') { send({ type: 'input_audio_buffer.committed', item_id: 'item' }); send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item', transcript: 'Hi' }) }
        if (value.type === 'response.create') { send({ type: 'response.audio.delta', delta: 'AAAAAA==' }); send({ type: 'response.done', response: { status: 'completed' } }) }
      })
    })
    const address = provider.address(); if (typeof address === 'string') throw new Error('address')
    messageConnect = () => new WebSocket(`ws://127.0.0.1:${address.port}`)
  }
  return { base: await listen(createProductionServer({ env, root, fetch: request, messageConnect })), calls, targets, env, quotaStarted }
}
const auth = { Authorization: 'Bearer good', Origin: 'https://english.lomivex.top' }
const chat = { messages: [{ role: 'user', content: 'JSON please' }], response_format: { type: 'json_object' } }
it('fails closed when production identity configuration is absent', () => {
  expect(() => createProductionServer({ env: {} })).toThrow()
})
it('authenticates all APIs, rejects disabled users and spoofed origins, and keeps health public', async () => {
  const { base } = await fixture()
  expect((await fetch(`${base}/healthz`)).status).toBe(200)
  expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true })
  expect((await fetch(`${base}/api/voice/config`)).status).toBe(401)
  expect((await fetch(`${base}/api/voice-history/cleanup`, { method: 'POST', headers: { Origin: auth.Origin } })).status).toBe(401)
  expect((await fetch(`${base}/api/voice-history/cleanup`, { method: 'POST', headers: { ...auth, Origin: 'https://evil.example' } })).status).toBe(403)
  expect((await fetch(`${base}/api/voice/config`, { headers: { Authorization: 'Bearer forged' } })).status).toBe(401)
  expect((await fetch(`${base}/api/voice/config`, { headers: { ...auth, Origin: 'https://evil.example' } })).status).toBe(403)
  expect((await fetch(`${base}/api/voice/config`, { headers: { ...auth, Origin: 'https://lomivex.top' } })).status).toBe(403)
  expect((await fetch(`${base}/api/voice/config`, { headers: auth })).status).toBe(200)
  const disabled = await fixture({ active: false })
  expect((await fetch(`${disabled.base}/api/voice/config`, { headers: auth })).status).toBe(403)
  expect((await fetch(`${disabled.base}/api/voice-history/cleanup`, { method: 'POST', headers: auth })).status).toBe(403)
})
it('locks provider paths, manages credentials, and never serves private or unknown API paths as HTML', async () => {
  const { base } = await fixture()
  expect((await fetch(`${base}/api/dictionary/elsewhere`, { headers: auth })).status).toBe(404)
  expect((await fetch(`${base}/api/deepseek/elsewhere`, { headers: auth })).status).toBe(404)
  expect((await fetch(`${base}/api/voice/config`, { method: 'PUT', headers: auth, body: '{}' })).status).toBe(403)
  expect(await (await fetch(`${base}/api/voice/config`, { headers: auth })).json()).toMatchObject({ managed: true })
  expect((await fetch(`${base}/.env`)).status).toBe(404)
  expect((await fetch(`${base}/src/main.tsx`)).status).toBe(404)
  expect((await fetch(`${base}/%2e%2e%2f.env`)).status).toBe(404)
  expect((await fetch(`${base}/api/missing`, { headers: auth })).status).toBe(404)
  expect((await fetch(`${base}/study`)).headers.get('content-type')).toContain('text/html')
})
it('preserves the existing fixed dictionary queries and never forwards user credentials to them', async () => {
  const { base, targets } = await fixture()
  expect((await fetch(`${base}/api/dictionary/api/v2/entries/en/coffee`, { headers: auth })).status).toBe(200)
  expect((await fetch(`${base}/api/youdao/jsonapi?doctype=json&jsonversion=4&q=coffee`, { headers: auth })).status).toBe(200)
  expect(targets.map(target => target.url)).toEqual(['https://api.dictionaryapi.dev/api/v2/entries/en/coffee', 'https://dict.youdao.com/jsonapi?doctype=json&jsonversion=2&q=coffee'])
  targets.forEach(target => expect(new Headers(target.headers).has('Authorization')).toBe(false))
})
it.each(['IFRS 16', 'COVID-19', 'e.g.', '24/7'])('looks up normal English expression %s through fixed encoded provider routes', async word => {
  const { base, targets } = await fixture()
  const encoded = encodeURIComponent(word)
  expect((await fetch(`${base}/api/dictionary/api/v2/entries/en/${encoded}`, { headers: auth })).status).toBe(200)
  expect((await fetch(`${base}/api/youdao/jsonapi?doctype=json&jsonversion=4&q=${encoded}`, { headers: auth })).status).toBe(200)
  expect(targets[0].url).toBe(`https://api.dictionaryapi.dev/api/v2/entries/en/${encoded}`)
  const bilingual = new URL(targets[1].url)
  expect(bilingual.origin + bilingual.pathname).toBe('https://dict.youdao.com/jsonapi')
  expect(Object.fromEntries(bilingual.searchParams)).toEqual({ doctype: 'json', jsonversion: '2', q: word })
  targets.forEach(target => expect(new Headers(target.headers).has('Authorization')).toBe(false))
})
it('accepts current dictionary requests while normalizing cached legacy requests to the supported provider schema', async () => {
  const { base, targets } = await fixture()
  const accepted = await Promise.all(['2', '4'].map(version =>
    fetch(`${base}/api/youdao/jsonapi?doctype=json&jsonversion=${version}&q=cover%20letter`, { headers: auth })))
  expect(accepted.map(response => response.status)).toEqual([200, 200])
  expect(targets).toHaveLength(2)
  for (const target of targets) {
    const url = new URL(target.url)
    expect(url.origin + url.pathname).toBe('https://dict.youdao.com/jsonapi')
    expect(url.searchParams.get('jsonversion')).toBe('2')
    expect(url.searchParams.get('q')).toBe('cover letter')
    expect(new Headers(target.headers).has('Authorization')).toBe(false)
  }
  const rejected = await Promise.all(['jsonversion=3', 'jsonversion=2&jsonversion=4'].map(query =>
    fetch(`${base}/api/youdao/jsonapi?doctype=json&${query}&q=coffee`, { headers: auth })))
  expect(rejected.map(response => response.status)).toEqual([400, 400])
  expect(targets).toHaveLength(2)
})
it('rejects blank, control-character and oversized lookups and extra proxy query fields', async () => {
  const { base, targets } = await fixture()
  await Promise.all([' ', '\t', 'coffee\n', 'hello\0', 'x'.repeat(101)].map(async word => {
    const encoded = encodeURIComponent(word)
    expect((await fetch(`${base}/api/dictionary/api/v2/entries/en/${encoded}`, { headers: auth })).status).toBe(400)
    expect((await fetch(`${base}/api/youdao/jsonapi?doctype=json&jsonversion=4&q=${encoded}`, { headers: auth })).status).toBe(400)
  }))
  expect((await fetch(`${base}/api/youdao/jsonapi?doctype=json&jsonversion=4&q=`, { headers: auth })).status).toBe(400)
  expect((await fetch(`${base}/api/youdao/jsonapi?doctype=json&jsonversion=4&q=coffee&url=https://example.com`, { headers: auth })).status).toBe(400)
  expect((await fetch(`${base}/api/dictionary/api/v2/entries/en/coffee?url=https://example.com`, { headers: auth })).status).toBe(404)
  expect(targets).toHaveLength(0)
})
it('reserves quota with server credentials and sends a bounded whitelisted payload with provider credentials', async () => {
  const { base, calls } = await fixture()
  const response = await fetch(`${base}/api/deepseek/v1/chat/completions`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...chat, max_tokens: 999999, tools: ['bad'], stream: true }) })
  expect(response.status).toBe(200)
  const quota = calls.find(call => call.path === '/rest/v1/rpc/reserve_usage')!
  expect(quota.apikey).toBe('sb_secret_test_private'); expect(quota.auth).toBeUndefined(); expect(quota.body).toMatchObject({ p_kind: 'deepseek' })
  const provider = calls.find(call => call.path === '/provider')!
  expect(provider.auth).toBe('Bearer provider-secret')
  expect(provider.body).toMatchObject({ stream: false, max_tokens: 2048 })
  expect(provider.body).not.toHaveProperty('tools')
})
it('rejects paid calls if quota is denied or unavailable, and requires origin for writes', async () => {
  await Promise.all([{ allowed: false }, { quotaError: true }].map(async options => {
    const { base, calls } = await fixture(options)
    expect((await fetch(`${base}/api/deepseek/v1/chat/completions`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(chat) })).status).toBe(options.quotaError ? 503 : 429)
    expect(calls.some(call => call.path === '/provider')).toBe(false)
  }))
  const { base } = await fixture()
  expect((await fetch(`${base}/api/deepseek/v1/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' }, body: JSON.stringify(chat) })).status).toBe(403)
})
it('rejects oversized or invalid JSON without consuming quota', async () => {
  const { base, calls } = await fixture()
  await Promise.all(([['{', 400], [JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(70000) }] }), 413], [JSON.stringify({ messages: [{ role: 'tool', content: 'bad' }] }), 400]] as const).map(async ([body, status]) => {
    expect((await fetch(`${base}/api/deepseek/v1/chat/completions`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body })).status).toBe(status)
  }))
  expect(calls.some(call => call.path.endsWith('reserve_usage'))).toBe(false)
})
it('isolates voice sessions per user, limits each owner, and charges each new message only once', async () => {
  const { base, calls } = await fixture({ voice: true })
  const post = (path: string, body: unknown, token = 'good') => fetch(`${base}${path}`, { method: 'POST', headers: { ...auth, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const first = await post('/api/voice/messages', { instructions: 'Practice' }); expect(first.status).toBe(201)
  const session = await first.json()
  expect((await post('/api/voice/messages', { instructions: 'Practice' })).status).toBe(429)
  expect((await post('/api/voice/messages', { instructions: 'Practice' }, 'other')).status).toBe(201)
  const path = `/api/voice/messages/${session.id}/turns`
  const turn = { id: 'turn-1', audio: Buffer.alloc(32000).toString('base64') }
  expect((await post(path, turn, 'other')).status).toBe(410)
  expect((await fetch(`${base}/api/voice/messages/${session.id}`, { method: 'DELETE', headers: { ...auth, Authorization: 'Bearer other' } })).status).toBe(410)
  expect((await post(path, turn)).status).toBe(200)
  expect((await post(path, turn)).status).toBe(200)
  const quotas = calls.filter(call => call.path.endsWith('reserve_usage'))
  expect(quotas.filter(call => call.body?.p_kind === 'voice_session')).toHaveLength(2)
  expect(quotas.filter(call => call.body?.p_kind === 'voice_message')).toHaveLength(1)
})
it('keeps the voice owner reservation locked across concurrent rejected requests', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const { base, quotaStarted, calls } = await fixture({ voice: true, quotaGate: gate })
  const create = () => fetch(`${base}/api/voice/messages`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ instructions: 'Practice' }) })
  const first = create()
  await quotaStarted
  const second = await create()
  const third = create()
  release()
  expect(second.status).toBe(429)
  expect((await third).status).toBe(429)
  expect((await first).status).toBe(201)
  expect(calls.filter(call => call.path.endsWith('reserve_usage'))).toHaveLength(1)
})
