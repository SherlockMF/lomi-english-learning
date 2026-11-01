import { createServer } from 'node:http'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createVoiceHandler } from './qwenVoiceServer.mjs'
import { cleanupVoiceHistory } from './voiceHistoryCleanup.mjs'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }
function send(res, status, value) {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
function fail(res, status, code) { send(res, status, { error: { code, message: '请求未完成，请稍后重试。' } }) }
function validLookup(word) {
  return typeof word === 'string' && /^[a-z0-9 .',&()/+:%!?_-]{1,100}$/i.test(word) && /[a-z0-9]/i.test(word)
}
async function readJson(req, limit = 64 * 1024) {
  let size = 0; const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) { const error = new Error('body'); error.status = 413; throw error }
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { const error = new Error('json'); error.status = 400; throw error }
}
export function createProductionServer({ env = process.env, fetch: request = globalThis.fetch, root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'), messageConnect } = {}) {
  const required = ['APP_ORIGIN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']
  if (required.some(key => typeof env[key] !== 'string' || !env[key].trim())) throw new Error('Missing production identity configuration')
  const origin = new URL(env.APP_ORIGIN).origin
  if (env.APP_ORIGIN !== origin || !origin.startsWith('https://')) throw new Error('APP_ORIGIN must be an HTTPS origin')
  const supabase = new URL(env.VITE_SUPABASE_URL)
  if (supabase.protocol !== 'https:' && !(supabase.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(supabase.hostname))) throw new Error('Invalid Supabase URL')
  const staticRoot = resolve(root)
  const call = (url, options = {}) => request(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(25000) })
  async function reserveUsage(userId, kind, requestId = randomUUID()) {
    const response = await call(new URL('/rest/v1/rpc/reserve_usage', supabase), {
      method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_request_id: requestId }),
    })
    if (!response.ok) throw new Error('quota-unavailable')
    const result = await response.json()
    if (typeof result?.allowed !== 'boolean') throw new Error('quota-unavailable')
    return result.allowed
  }
  const voice = createVoiceHandler({ env, fetch: call, productionOrigin: origin, messageConnect, reserveUsage })
  async function authenticate(req, res) {
    const token = req.headers.authorization
    if (typeof token !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(token)) { fail(res, 401, 'unauthorized'); return false }
    const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: token }
    const userResponse = await call(new URL('/auth/v1/user', supabase), { headers })
    if (!userResponse.ok) { fail(res, userResponse.status === 401 || userResponse.status === 403 ? 401 : 503, 'unauthorized'); return false }
    const user = await userResponse.json()
    if (typeof user?.id !== 'string' || !/^[a-f\d-]{36}$/i.test(user.id)) { fail(res, 401, 'unauthorized'); return false }
    const membership = new URL('/rest/v1/app_memberships', supabase)
    membership.searchParams.set('user_id', `eq.${user.id}`); membership.searchParams.set('select', 'active')
    const response = await call(membership, { headers })
    if (!response.ok) { fail(res, 503, 'membership-unavailable'); return false }
    const rows = await response.json()
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].active !== true) { fail(res, 403, 'inactive'); return false }
    req.authUserId = user.id
    return true
  }
  async function proxy(res, target, options, maxBytes = 2 * 1024 * 1024) {
    const response = await call(target, options)
    if (!response.ok) { await response.body?.cancel(); fail(res, response.status === 429 ? 429 : response.status === 404 ? 404 : 502, 'provider-failed'); return }
    let size = 0; const chunks = []
    for await (const chunk of response.body || []) { size += chunk.length; if (size > maxBytes) throw new Error('upstream-too-large'); chunks.push(Buffer.from(chunk)) }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(Buffer.concat(chunks))
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    try {
      const url = new URL(req.url || '/', origin)
      const path = url.pathname
      if (path === '/healthz' && req.method === 'GET') { send(res, 200, { ok: true }); return }
      if (path === '/api' || path.startsWith('/api/')) {
        if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site' || (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin)) { fail(res, 403, 'origin'); return }
        if (!(await authenticate(req, res))) return
        if (path === '/api/voice-history/cleanup' && req.method === 'POST' && !url.search) {
          try { send(res, 200, await cleanupVoiceHistory({ userId: req.authUserId, supabase, secret: env.SUPABASE_SECRET_KEY, call })) }
          catch { fail(res, 503, 'voice-cleanup-unavailable') }
          return
        }
        if (await voice(req, res)) return
        const dictionary = /^\/api\/dictionary\/api\/v2\/entries\/en\/([^/]+)$/.exec(path)
        if (dictionary && req.method === 'GET' && !url.search) {
          const word = decodeURIComponent(dictionary[1])
          if (!validLookup(word)) { fail(res, 400, 'word'); return }
          await proxy(res, `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`); return
        }
        if (path === '/api/youdao/jsonapi' && req.method === 'GET') {
          if ([...url.searchParams.keys()].some(key => !['q', 'doctype', 'jsonversion'].includes(key)) || ['q', 'doctype', 'jsonversion'].some(key => url.searchParams.getAll(key).length !== 1) || url.searchParams.get('doctype') !== 'json' || !['2', '4'].includes(url.searchParams.get('jsonversion')) || !validLookup(url.searchParams.get('q'))) { fail(res, 400, 'query'); return }
          // Cached clients still request schema 4, which the provider rejects with HTTP 200.
          const query = new URLSearchParams(url.search)
          query.set('jsonversion', '2')
          await proxy(res, `https://dict.youdao.com/jsonapi?${query}`); return
        }
        if (path === '/api/deepseek/v1/chat/completions' && req.method === 'POST' && !url.search) {
          if (!env.DEEPSEEK_API_KEY) { fail(res, 503, 'not-configured'); return }
          if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { fail(res, 415, 'content-type'); return }
          const value = await readJson(req)
          if (!Array.isArray(value?.messages) || value.messages.length < 1 || value.messages.length > 32 || value.messages.some(message => !['system', 'user', 'assistant'].includes(message?.role) || typeof message.content !== 'string' || message.content.length > 24000)) { fail(res, 400, 'messages'); return }
          const payload = { model: 'deepseek-v4-flash', messages: value.messages.map(({ role, content }) => ({ role, content })), response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, stream: false, max_tokens: Math.min(2048, Math.max(1, Number.isInteger(value.max_tokens) ? value.max_tokens : 2048)) }
          if (!(await reserveUsage(req.authUserId, 'deepseek'))) { fail(res, 429, 'quota'); return }
          await proxy(res, 'https://api.deepseek.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return
        }
        fail(res, 404, 'not-found'); return
      }
      if (!['GET', 'HEAD'].includes(req.method)) { fail(res, 405, 'method'); return }
      const decoded = decodeURIComponent(path)
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.') || ['src', 'scripts', 'node_modules'].includes(part))) { fail(res, 404, 'not-found'); return }
      let file = resolve(staticRoot, `.${decoded === '/' ? '/index.html' : decoded}`)
      if (!file.startsWith(staticRoot + sep)) { fail(res, 404, 'not-found'); return }
      try { if (!statSync(file).isFile()) throw new Error('not-file') } catch {
        if (extname(decoded)) { fail(res, 404, 'not-found'); return }
        file = join(staticRoot, 'index.html')
      }
      const real = realpathSync(file)
      if (!real.startsWith(realpathSync(staticRoot) + sep) || !MIME[extname(real)]) { fail(res, 404, 'not-found'); return }
      res.writeHead(200, { 'Content-Type': MIME[extname(real)], 'Cache-Control': /[.-][a-zA-Z0-9_-]{8,}\./.test(real) && !real.endsWith('.html') ? 'public, max-age=31536000, immutable' : 'no-cache' })
      if (req.method === 'HEAD') res.end()
      else createReadStream(real).on('error', () => res.destroy()).pipe(res)
    } catch (error) { if (res.headersSent) res.destroy(); else fail(res, error.status || 503, 'request-failed') }
  })
  server.requestTimeout = 40000
  server.headersTimeout = 15000
  server.once('close', voice.close)
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = createProductionServer()
    const port = Number(process.env.PORT || 3000)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
    server.listen(port, '0.0.0.0', () => console.log(`Lomi English listening on port ${port}`))
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(); setTimeout(() => process.exit(0), 10000).unref() })
  } catch { console.error('Production server configuration is incomplete or invalid.'); process.exitCode = 1 }
}
