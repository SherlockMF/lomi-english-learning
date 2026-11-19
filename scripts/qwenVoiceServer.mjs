import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createVoiceMessageHandler } from './qwenVoiceMessages.mjs'

const MODEL = 'qwen3.8-omni-flash-realtime'
const MAX_BYTES = 64 * 1024
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i

export function loadVoiceEnv(directory, fallbackDirectory) {
  const root = ['.env.local', '.env'].some((name) => existsSync(join(directory, name))) ? directory : fallbackDirectory || directory
  let values = {}
  for (const name of ['.env', '.env.local']) {
    const path = join(root, name)
    if (existsSync(path)) values = { ...values, ...parseEnv(readFileSync(path, 'utf8')) }
  }
  return { ...values, ...process.env }
}

function reply(res, status, body, contentType = 'application/json; charset=utf-8', extra = {}) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store', ...extra })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

function fail(res, status, code, message, extra) {
  reply(res, status, { error: { code, message } }, undefined, extra)
}

function readBody(req, signal, maxBytes = MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAbort)
      signal.removeEventListener('abort', onAbort)
    }
    const onError = (error) => { cleanup(); req.resume(); reject(error) }
    const onAbort = () => onError(new Error('aborted'))
    const onData = (chunk) => {
      bytes += chunk.length
      if (bytes > maxBytes) onError(new RangeError('Request body exceeds limit'))
      else chunks.push(chunk)
    }
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')) }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

function validCredentials(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.apiKey === 'string' && /^[\x21-\x7e]{1,2048}$/.test(value.apiKey)
    && typeof value.workspaceId === 'string' && /^[a-z\d_-]{1,128}$/i.test(value.workspaceId)
}

function persistCredentials(path, value) {
  if (!path) throw new Error('Credential storage unavailable')
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function createVoiceHandler({ env = process.env, fetch: request = globalThis.fetch, credentialFile, messageConnect, productionOrigin, reserveUsage, canStartVoice, reserveVoiceTurn } = {}) {
  if (productionOrigin && typeof reserveUsage !== 'function') throw new Error('Production voice quota is required')
  const messages = createVoiceMessageHandler({ connect: messageConnect, production: Boolean(productionOrigin), reserveUsage, canStartVoice, reserveVoiceTurn })
  const rateStates = new Map()
  let savedCredentials
  let storageError = false
  if (!productionOrigin && credentialFile && existsSync(credentialFile)) {
    try {
      const saved = JSON.parse(readFileSync(credentialFile, 'utf8'))
      if (!validCredentials(saved) && !(saved?.apiKey === '' && saved?.workspaceId === '')) throw new Error('Invalid saved credentials')
      savedCredentials = saved
    } catch { storageError = true }
  }
  const handler = async (req, res) => {
    const path = (req.url || '').split('?')[0]
    if (!path.startsWith('/api/voice/')) return false
    const host = req.headers.host || ''
    const origin = req.headers.origin
    const localAddress = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    if (productionOrigin ? !req.authUserId || req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== productionOrigin) || (req.method !== 'GET' && origin !== productionOrigin)
      : !localAddress || !LOCAL_HOST.test(host) || req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${host}` && origin !== `https://${host}`)) {
      fail(res, 403, 'local-only', '语音接口仅允许本机同源访问。')
      return true
    }
    if (path === '/api/voice/config' && ['PUT', 'DELETE'].includes(req.method)) {
      if (productionOrigin) { fail(res, 403, 'managed', '口语服务由管理员配置。'); return true }
      if (!origin) { fail(res, 403, 'origin', '缺少同源请求信息。'); return true }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const onClose = () => { if (!res.writableEnded) controller.abort() }
      res.on('close', onClose)
      try {
        let value = { apiKey: '', workspaceId: '' }
        if (req.method === 'PUT') {
          if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { fail(res, 415, 'content-type', '配置请求需要 JSON 格式。'); return true }
          if (Number(req.headers['content-length']) > 8192) { fail(res, 413, 'too-large', '配置请求过大。'); return true }
          const body = await readBody(req, controller.signal, 8192)
          let payload
          try { payload = JSON.parse(body) } catch { fail(res, 400, 'invalid-config', '配置格式无效。'); return true }
          value = { apiKey: typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '', workspaceId: typeof payload?.workspaceId === 'string' ? payload.workspaceId.trim() : '' }
          if (!validCredentials(value)) { fail(res, 400, 'invalid-config', '请填写有效的 API Key 和北京业务空间 ID。'); return true }
        }
        if (controller.signal.aborted) { fail(res, 504, 'config-timeout', '配置请求超时或已取消。'); return true }
        try { persistCredentials(credentialFile, value) } catch { fail(res, 500, 'config-storage', '无法保存本机配置，请检查服务目录的写入权限。'); return true }
        savedCredentials = value
        storageError = false
        reply(res, 200, { configured: req.method === 'PUT', model: MODEL, maxSeconds: null })
      } catch (error) {
        if (error instanceof RangeError) fail(res, 413, 'too-large', '配置请求过大。')
        else fail(res, controller.signal.aborted ? 504 : 400, 'config-failed', '配置请求未完成，请重试。')
      } finally { clearTimeout(timeout); res.off('close', onClose) }
      return true
    }
    if (storageError) { fail(res, 503, 'config-storage', '本机口语配置无法读取，请重新保存或清除配置。'); return true }
    const key = savedCredentials ? savedCredentials.apiKey : env.DASHSCOPE_API_KEY?.trim()
    const workspace = savedCredentials ? savedCredentials.workspaceId : env.DASHSCOPE_WORKSPACE_ID?.trim()
    const configured = Boolean(validCredentials({ apiKey: key, workspaceId: workspace }))
    if (path === '/api/voice/config' && req.method === 'GET') {
      reply(res, 200, { configured, model: MODEL, maxSeconds: null, ...(productionOrigin ? { managed: true } : {}) })
      return true
    }
    if (path === '/api/voice/config') { fail(res, 405, 'method', '此接口仅接受 GET、PUT 或 DELETE。', { Allow: 'GET, PUT, DELETE' }); return true }
    if (await messages(req, res, configured ? { apiKey: key, workspaceId: workspace } : undefined)) return true
    if (path !== '/api/voice/session') {
      fail(res, 404, 'not-found', '语音接口不存在。')
      return true
    }
    if (req.method !== 'POST') {
      fail(res, 405, 'method', '此接口仅接受 POST。', { Allow: 'POST' })
      return true
    }
    if (!origin) {
      fail(res, 403, 'origin', '缺少同源请求信息。')
      return true
    }
    if (!configured) {
      fail(res, 503, 'not-configured', '请在学习设置中保存百炼 API Key 和北京地域业务空间 ID。')
      return true
    }
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/sdp') {
      fail(res, 415, 'content-type', '需要 application/sdp 请求。')
      return true
    }
    if (Number(req.headers['content-length']) > MAX_BYTES) {
      fail(res, 413, 'too-large', '连接请求过大。')
      return true
    }
    const rateKey = productionOrigin ? req.authUserId : 'local'
    for (const [id, state] of rateStates) if (!state.inFlight && state.starts.every(time => Date.now() - time >= 60_000)) rateStates.delete(id)
    const rate = rateStates.get(rateKey) || { inFlight: false, starts: [] }
    rateStates.set(rateKey, rate)
    rate.starts = rate.starts.filter((time) => Date.now() - time < 60_000)
    if (rate.inFlight || rate.starts.length >= 3 || rateStates.size > 100) {
      fail(res, 429, 'rate-limit', '连接请求过于频繁，请一分钟后重试。', { 'Retry-After': '60' })
      return true
    }
    rate.inFlight = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const onClose = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', onClose)
    try {
      const sdp = await readBody(req, controller.signal)
      if (!sdp.startsWith('v=0') || !/^m=audio\s/m.test(sdp)) {
        fail(res, 400, 'sdp', '连接请求缺少有效的音频 SDP。')
        return true
      }
      if (controller.signal.aborted) throw new Error('aborted')
      if (productionOrigin) {
        let allowed
        try {
          if (canStartVoice && !(await canStartVoice(req.authUserId, true))) {
            fail(res, 403, 'voice-mode', '试用口语请使用语音消息模式。'); return true
          }
          allowed = await reserveUsage(req.authUserId, 'voice_session')
        } catch { fail(res, 503, 'quota-unavailable', '暂时无法检查口语额度。'); return true }
        if (!allowed) { fail(res, 429, 'quota', '今日口语额度已用完。'); return true }
      }
      rate.starts.push(Date.now())
      const upstream = await request(`https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=${MODEL}`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/sdp' },
        body: sdp, signal: controller.signal, redirect: 'error',
      })
      if (!upstream.ok) {
        if (upstream.status === 429) fail(res, 429, 'provider-limit', '百炼额度或调用频率受限，请检查控制台。', { 'Retry-After': '60' })
        else if ([401, 403, 404].includes(upstream.status)) fail(res, 503, 'provider-access', '百炼凭证、北京地域业务空间或模型权限不可用，请检查配置。')
        else fail(res, 502, 'provider-failed', '百炼语音服务暂时不可用，请稍后手动重试。')
        await upstream.body?.cancel()
        return true
      }
      const answer = await upstream.text()
      if (!answer.startsWith('v=0') || answer.length > MAX_BYTES) {
        fail(res, 502, 'provider-response', '语音服务返回了无效的连接信息。')
        return true
      }
      reply(res, 200, answer, 'application/sdp')
    } catch (error) {
      if (error instanceof RangeError) fail(res, 413, 'too-large', '连接请求过大。')
      else fail(res, controller.signal.aborted ? 504 : 502, 'connection-failed', controller.signal.aborted ? '语音连接超时或已取消。' : '无法连接百炼语音服务，请检查网络。')
    } finally {
      clearTimeout(timer)
      res.off('close', onClose)
      rate.inFlight = false
    }
    return true
  }
  handler.close = messages.close
  return handler
}
