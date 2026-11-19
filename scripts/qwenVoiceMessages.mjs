import WebSocket from 'ws'
import { randomUUID, createHash } from 'node:crypto'

const MAX_AUDIO = 16000 * 2 * 60
const MAX_REPLY = 24000 * 2 * 90
const MAX_BODY = Math.ceil(MAX_AUDIO * 4 / 3) + 4096

function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(value === undefined ? undefined : JSON.stringify(value))
}
const failure = (res, status, message) => json(res, status, { error: { code: 'voice-message', message } })

function body(req, limit) {
  return new Promise((resolve, reject) => {
    let bytes = 0
    const chunks = []
    const cleanup = () => {
      clearTimeout(timer)
      req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted)
    }
    const error = (cause) => { cleanup(); req.resume(); reject(cause) }
    const aborted = () => error(new Error('Request interrupted'))
    const data = (chunk) => {
      bytes += chunk.length
      if (bytes > limit) error(new RangeError('too large'))
      else chunks.push(chunk)
    }
    const end = () => { cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (cause) { reject(cause) } }
    const timer = setTimeout(aborted, 10000)
    timer.unref()
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted)
    if (req.aborted) aborted()
  })
}

function providerMessage(error) {
  if (error?.type === 'rate_limit_error') return '百炼调用频率受限，请稍后重试。'
  if (['authentication_error', 'permission_error'].includes(error?.type)) return '请检查北京业务空间、Key 和模型权限。'
  if (error?.type === 'invalid_request_error') return '百炼拒绝了语音消息会话参数。请重新开始练习。'
  return '百炼语音消息服务返回错误，请重新开始练习。'
}

export function createVoiceMessageHandler({ connect = (url, options) => new WebSocket(url, options), production = false, reserveUsage, canStartVoice, reserveVoiceTurn } = {}) {
  const sessions = new Map()
  const starts = new Map()
  const pendingOwners = new Set()
  const clean = () => {
    const now = Date.now()
    for (const [owner, times] of starts) { const recent = times.filter(time => now - time < 60000); if (recent.length) starts.set(owner, recent); else starts.delete(owner) }
    if (production) for (const session of sessions.values()) if (!session.current && now - session.lastUsed > 15 * 60000) dispose(session)
  }
  const idleTimer = production ? setInterval(clean, 60000) : undefined
  idleTimer?.unref()
  function dispose(session, message = '语音消息会话已结束。') {
    if (session.closed) return
    session.closed = true
    sessions.delete(session.id)
    clearTimeout(session.setupTimeout)
    session.setupReject?.(new Error(message))
    session.current?.reject(new Error(message))
    session.current = undefined; session.cached = undefined
    session.socket.on('error', () => undefined)
    session.socket.terminate()
  }
  function send(session, event) {
    if (session.closed || session.socket.readyState !== WebSocket.OPEN) throw new Error('语音消息连接已断开。')
    session.socket.send(JSON.stringify(event))
  }
  function finishTurn(session) {
    const turn = session.current
    if (!turn?.done || !turn.transcribed) return
    clearTimeout(turn.timeout); clearTimeout(turn.transcriptionTimeout)
    const pcm = Buffer.concat(turn.chunks)
    const result = { id: turn.id, userText: turn.userText, text: turn.text, audio: pcm.toString('base64'), sampleRate: 24000, usage: turn.usage }
    if (!pcm.length || pcm.length % 2) { dispose(session, 'AI 未返回可播放的语音，请重新开始练习。'); return }
    session.current = undefined
    session.cached = { id: turn.id, hash: turn.hash, result }
    turn.resolve(result)
  }
  function receive(session, raw) {
    if (session.closed) return
    let event
    try { event = JSON.parse(raw.toString()) } catch { dispose(session, '语音服务返回无效消息。'); return }
    try {
      if (event.type === 'error') { dispose(session, providerMessage(event.error)); return }
      if (event.type === 'session.created' && !session.configured) {
        session.configured = true
        send(session, { type: 'session.update', session: {
          modalities: ['text', 'audio'], turn_detection: null,
          audio: { input: { format: { type: 'pcm', sample_rate: 16000 } }, output: { voice: 'Tina', format: { type: 'pcm', sample_rate: 24000 } } },
          input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
          instructions: session.instructions, enable_search: false, max_tokens: 512,
        } })
      } else if (event.type === 'session.updated' && session.configured && !session.ready) {
        session.ready = true; clearTimeout(session.setupTimeout)
        session.setupResolve()
      }
      const turn = session.current
      if (!turn) return
      if (event.type === 'input_audio_buffer.committed' && !turn.committed) {
        turn.committed = true; turn.itemId = event.item_id
        send(session, { type: 'response.create' })
      } else if (event.type === 'conversation.item.input_audio_transcription.completed' && event.item_id === turn.itemId) {
        turn.userText = typeof event.transcript === 'string' ? event.transcript.slice(0, 10000) : ''
        turn.transcribed = true; finishTurn(session)
      } else if (event.type === 'conversation.item.input_audio_transcription.failed' && event.item_id === turn.itemId) {
        turn.transcribed = true; finishTurn(session)
      } else if (event.type === 'response.audio.delta' && typeof event.delta === 'string') {
        const chunk = Buffer.from(event.delta, 'base64')
        turn.bytes += chunk.length
        if (turn.bytes > MAX_REPLY) { dispose(session, 'AI 语音回复过长，练习已结束。'); return }
        turn.chunks.push(chunk)
      } else if (event.type === 'response.audio_transcript.delta' && typeof event.delta === 'string') {
        turn.text = (turn.text + event.delta).slice(0, 10000)
      } else if (event.type === 'response.audio_transcript.done' && typeof event.transcript === 'string') {
        turn.text = event.transcript.slice(0, 10000)
      } else if (event.type === 'response.done') {
        if (event.response?.status !== 'completed') { dispose(session, 'AI 语音回复未完成，请重新开始练习。'); return }
        turn.done = true
        turn.usage = Object.fromEntries(['input_tokens', 'output_tokens', 'total_tokens'].flatMap((key) => {
          const value = event.response?.usage?.[key]
          return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? [[key, value]] : []
        }))
        if (!turn.transcribed) {
          turn.transcriptionTimeout = setTimeout(() => { turn.transcribed = true; finishTurn(session) }, 3000)
          turn.transcriptionTimeout.unref()
        }
        finishTurn(session)
      }
    } catch { dispose(session, '语音消息连接已断开，请重新开始练习。') }
  }

  const handler = async (req, res, credentials) => {
    const path = (req.url || '').split('?')[0]
    if (path !== '/api/voice/messages' && !path.startsWith('/api/voice/messages/')) return false
    if (!req.headers.origin) { failure(res, 403, '缺少同源请求信息。'); return true }
    const owner = production ? req.authUserId : 'local'
    if (!owner) { failure(res, 401, '请先登录。'); return true }
    clean()
    const busy = () => pendingOwners.has(owner) || [...sessions.values()].some(session => session.owner === owner) || (starts.get(owner)?.length || 0) >= 3 || sessions.size + pendingOwners.size >= (production ? 50 : 1)
    const parts = path.slice('/api/voice/messages'.length).split('/').filter(Boolean)
    if (!parts.length) {
      if (req.method !== 'POST') { failure(res, 405, '建立语音消息会话需要 POST。'); return true }
      if (!credentials) { failure(res, 503, '请先在学习设置中保存千问口语配置。'); return true }
      if (busy()) { failure(res, 429, '语音消息会话尚未结束，或连接请求过于频繁，请稍后重试。'); return true }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') { failure(res, 415, '需要 JSON 请求。'); return true }
      let session
      let ownsReservation = false
      try {
        const value = await body(req, 8192)
        if (!value || typeof value.instructions !== 'string' || !value.instructions.trim() || value.instructions.length > 6000) { failure(res, 400, '练习场景信息无效。'); return true }
        // Recheck after reading the body so parallel requests cannot reserve two sessions.
        if (busy()) { failure(res, 429, '已有语音消息会话，或连接请求过于频繁，请稍后重试。'); return true }
        pendingOwners.add(owner)
        ownsReservation = true
        if (production) {
          let allowed
          try {
            allowed = (!canStartVoice || await canStartVoice(owner, false)) && await reserveUsage(owner, 'voice_session')
          } catch { failure(res, 503, '暂时无法检查口语额度。'); return true }
          if (!allowed) { failure(res, 429, '当前口语额度已用完或已到期。'); return true }
        }
        starts.set(owner, [...(starts.get(owner) || []), Date.now()])
        const socket = connect(`wss://${credentials.workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime`, { headers: { Authorization: `Bearer ${credentials.apiKey}` }, handshakeTimeout: 15000, maxPayload: 8 * 1024 * 1024 })
        session = { id: randomUUID(), owner, lastUsed: Date.now(), socket, instructions: value.instructions, closed: false, seen: new Map() }
        sessions.set(session.id, session)
        const ready = new Promise((resolve, reject) => { session.setupResolve = resolve; session.setupReject = reject })
        session.setupTimeout = setTimeout(() => dispose(session, '建立语音消息连接超时，请重试。'), 20000)
        session.setupTimeout.unref()
        socket.on('message', (data) => receive(session, data))
        socket.on('error', () => dispose(session, '无法连接百炼语音消息服务，请检查网络或配置。'))
        socket.on('close', () => dispose(session, '语音消息连接已断开，请重新开始练习。'))
        const disconnected = () => { if (!res.writableEnded) dispose(session, '已取消建立语音消息连接。') }
        res.on('close', disconnected)
        try { await ready } finally { res.off('close', disconnected); session.setupReject = undefined }
        if (res.destroyed) dispose(session)
        else json(res, 201, { id: session.id, maxSeconds: null })
      } catch (error) {
        if (session) dispose(session)
        failure(res, error instanceof RangeError ? 413 : session ? 502 : 400, session ? error.message : '语音消息请求无效或过大。')
      } finally { if (ownsReservation) pendingOwners.delete(owner) }
      return true
    }
    const session = sessions.get(parts[0])
    if (session && session.owner !== owner) { failure(res, 410, '语音消息会话已结束，请重新开始。'); return true }
    if (parts.length === 1 && req.method === 'DELETE') { if (session) dispose(session); json(res, 204); return true }
    if (!session) { failure(res, 410, '语音消息会话已结束，请重新开始。'); return true }
    session.lastUsed = Date.now()
    if (parts.length !== 2 || parts[1] !== 'turns') { failure(res, 404, '语音消息接口不存在。'); return true }
    if (req.method !== 'POST') { failure(res, 405, '发送语音需要 POST。'); return true }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') { failure(res, 415, '需要 JSON 请求。'); return true }
    let ownedTurn
    try {
      const value = await body(req, MAX_BODY)
      if (session.closed) { failure(res, 410, '语音消息会话已结束，请重新开始。'); return true }
      if (!value || typeof value.id !== 'string' || !/^[a-z\d_-]{1,80}$/i.test(value.id) || typeof value.audio !== 'string' || value.audio.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.audio)) { failure(res, 400, '语音消息格式无效。'); return true }
      const pcm = Buffer.from(value.audio, 'base64')
      if (pcm.length < 32000 || pcm.length > MAX_AUDIO || pcm.length % 2) { failure(res, 400, '请录制 1—60 秒的语音。'); return true }
      const hash = createHash('sha256').update(pcm).digest('hex')
      if (session.seen.has(value.id)) {
        if (session.seen.get(value.id) !== hash) failure(res, 409, '同一消息编号不能用于不同录音。')
        else if (session.cached?.id === value.id) json(res, 200, session.cached.result)
        else if (session.current?.id === value.id) json(res, 200, await session.current.promise)
        else failure(res, 409, '这条录音已处理，请勿重复发送。')
        return true
      }
      if (session.current) { failure(res, 409, 'AI 正在回复，请稍后发送下一条。'); return true }
      if (session.reserving) { failure(res, 409, '消息正在提交，请稍后重试。'); return true }
      if (production) {
        session.reserving = true
        try {
          const hex = createHash('sha256').update(`${owner}/${session.id}/${value.id}`).digest('hex')
          const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
          let allowed
          try {
            // 16 kHz, 16-bit, mono PCM contains 32 bytes per millisecond.
            allowed = reserveVoiceTurn ? await reserveVoiceTurn(owner, requestId, Math.ceil(pcm.length / 32))
              : await reserveUsage(owner, 'voice_message', requestId)
          } catch { failure(res, 503, '暂时无法检查口语额度。'); return true }
          if (!allowed) { failure(res, 429, '语音额度不足或已到期。请查看套餐页。'); return true }
          if (session.closed) { failure(res, 410, '语音消息会话已结束。'); return true }
        } finally { session.reserving = false }
      }
      session.seen.set(value.id, hash)
      const turn = { id: value.id, hash, chunks: [], bytes: 0, userText: '', text: '' }
      turn.promise = new Promise((resolve, reject) => {
        turn.resolve = resolve
        turn.reject = (error) => { clearTimeout(turn.timeout); clearTimeout(turn.transcriptionTimeout); reject(error) }
      })
      // A synchronous send failure can reject before the HTTP handler reaches await.
      void turn.promise.catch(() => undefined)
      ownedTurn = turn
      session.current = turn
      turn.timeout = setTimeout(() => dispose(session, 'AI 语音回复超时，请重新开始练习。'), 45000)
      turn.timeout.unref()
      for (let offset = 0; offset < pcm.length; offset += 3200) send(session, { type: 'input_audio_buffer.append', audio: pcm.subarray(offset, offset + 3200).toString('base64') })
      send(session, { type: 'input_audio_buffer.commit' })
      json(res, 200, await turn.promise)
    } catch (error) {
      if (ownedTurn && session.current === ownedTurn) dispose(session)
      failure(res, error instanceof RangeError ? 413 : error instanceof SyntaxError ? 400 : 502, error instanceof RangeError || error instanceof SyntaxError ? '录音请求无效或过大。' : ownedTurn || session.closed ? error.message : '录音请求中断，请重试。')
    }
    return true
  }
  handler.close = () => { clearInterval(idleTimer); for (const session of sessions.values()) dispose(session) }
  return handler
}
