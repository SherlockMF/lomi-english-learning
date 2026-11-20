import { voiceInstructions, type VoiceOptions } from './scenarios'
import { asRecord, createTranscriptReducer, type VoiceTurn } from './transcript'
import { monitorMicrophone } from './audio'
import { apiFetch } from '../apiFetch'

export interface VoiceSnapshot {
  phase: 'idle' | 'connecting' | 'ready' | 'listening' | 'thinking' | 'speaking' | 'paused' | 'resuming' | 'ended' | 'error'
  turns: VoiceTurn[]
  elapsedSeconds: number
  muted: boolean
  needsAudio: boolean
  notice: string
  usage: { inputTokens: number; outputTokens: number; estimatedYuan: number; complete: boolean }
}
export const EMPTY_VOICE_SNAPSHOT: VoiceSnapshot = { phase: 'idle', turns: [], elapsedSeconds: 0, muted: false, needsAudio: false, notice: '', usage: { inputTokens: 0, outputTokens: 0, estimatedYuan: 0, complete: false } }

const tokenCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const NO_RESPONSE_TO_CANCEL = /^(?:no (?:active|ongoing) response to cancel\.?|cannot cancel a response that is not in progress\.?)$/i
const ERROR_TYPES = new Set(['invalid_request_error', 'authentication_error', 'permission_error', 'rate_limit_error', 'server_error'])
const ERROR_CODES = new Set(['invalid_value', 'invalid_request', 'invalid_event', 'unknown_parameter', 'missing_required_parameter', 'unsupported_parameter', 'rate_limit_exceeded', 'server_error', 'response_already_in_progress', 'response_cancel_not_active', '400', '401', '403', '429', '500', '503'])
const ERROR_PARAMS = new Set(['session', 'session.modalities', 'session.voice', 'session.audio', 'session.audio.output.voice', 'session.instructions', 'session.input_audio_transcription', 'session.input_audio_transcription.model', 'session.turn_detection', 'session.turn_detection.type', 'session.turn_detection.threshold', 'session.turn_detection.silence_duration_ms', 'session.enable_search', 'session.max_tokens', 'response.create', 'response.cancel'])
const VAD_TYPES = new Set(['server_vad', 'semantic_vad', 'semantic_vad_ec'])
const TURN_END_SILENCE_MS = 1600
const TURN_DETECTION_FIELDS = new Set(['session.turn_detection', 'session.turn_detection.type', 'session.turn_detection.silence_duration_ms'])

function serviceErrorNotice(error: Record<string, unknown>, stage: string): string {
  // Never echo arbitrary provider messages, which may include private values.
  const details = [
    ERROR_TYPES.has(String(error.type)) ? error.type : undefined,
    ERROR_CODES.has(String(error.code)) ? error.code : undefined,
    ERROR_PARAMS.has(String(error.param)) ? error.param : undefined,
  ].filter((value) => value !== undefined).join(' · ')
  const reason = error.type === 'invalid_request_error' ? '会话参数或控制指令被百炼拒绝。'
    : error.type === 'rate_limit_error' ? '百炼调用频率受限，请稍后重试。'
      : ['authentication_error', 'permission_error'].includes(String(error.type)) ? '请检查北京业务空间、凭证和模型权限。'
        : '百炼返回服务错误，请稍后重试。'
  return `${stage}失败${details ? `（${details}）` : ''}。${reason}`
}

export class VoiceSession {
  snapshot: VoiceSnapshot = { ...EMPTY_VOICE_SNAPSHOT, turns: [], usage: { ...EMPTY_VOICE_SNAPSHOT.usage } }
  private readonly options: VoiceOptions & { audio: HTMLAudioElement; onChange: (state: VoiceSnapshot) => void; onLevel?: (level: number) => void }
  private readonly controller = new AbortController()
  private readonly reduceTranscript = createTranscriptReducer()
  private readonly channels = new Set<RTCDataChannel>()
  private readonly responses = new Set<string>()
  private pc?: RTCPeerConnection
  private stream?: MediaStream
  private senders: { sender: RTCRtpSender; track: MediaStreamTrack }[] = []
  private channel?: RTCDataChannel
  private closed = false
  private configured = false
  private initialVAD = '未返回'
  private useDefaultVAD = false
  private acknowledged = false
  private startedAt = 0
  private accumulatedMs = 0
  private microphoneEpoch = 0
  private readonly suspendedResponses = new Set<string>()
  private remoteStream?: MediaStream
  private activityAt = 0
  private activeResponse = false
  private pendingReplies: boolean[] = []
  private activeResponseId?: string
  private cancellation?: { responseId: string; requestedAt: number; completed: boolean }
  private helpState: 'idle' | 'waiting' | 'responding' | 'restoring' = 'idle'
  private timeout?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>
  private stopMeter?: () => void

  constructor(options: VoiceOptions & { audio: HTMLAudioElement; onChange: (state: VoiceSnapshot) => void; onLevel?: (level: number) => void }) {
    this.options = options
  }

  private update(patch: Partial<VoiceSnapshot>) {
    if (this.closed) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.options.onChange(this.snapshot)
  }

  private wait<T>(promise: Promise<T>): Promise<T> {
    const signal = this.controller.signal
    if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new DOMException('Cancelled', 'AbortError'))
      signal.addEventListener('abort', aborted, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
    })
  }

  async start(): Promise<void> {
    if (this.closed || this.snapshot.phase !== 'idle') return
    this.options.audio.muted = false
    this.update({ phase: 'connecting' })
    this.timeout = setTimeout(() => this.finish('error', '连接超时。请检查麦克风权限、网络和百炼配置。'), 30_000)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('pagehide', this.onPageHide)
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
        throw new Error('当前浏览器不支持语音连接。请使用 HTTPS 或 localhost 下的最新版浏览器。')
      }
      const media = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        .then((stream) => {
          if (this.closed) stream.getTracks().forEach((track) => track.stop())
          return stream
        })
      const stream = await this.wait(media)
      if (this.closed) return
      this.stream = stream
      if (this.options.onLevel) this.stopMeter = monitorMicrophone(stream, this.options.onLevel)
      const pc = new RTCPeerConnection()
      this.pc = pc
      this.senders = stream.getAudioTracks().map((track) => {
        track.enabled = false
        return { sender: pc.addTrack(track, stream), track }
      })
      await this.wait(Promise.all(this.senders.map(({ sender }) => sender.replaceTrack(null))))
      if (this.closed) return
      pc.addEventListener('track', (event) => {
        if (this.closed) return
        this.remoteStream = event.streams[0] ?? new MediaStream([event.track])
        if (this.suspended) return
        this.options.audio.srcObject = this.remoteStream
        void this.enableAudio()
      })
      pc.addEventListener('datachannel', (event) => this.attachChannel(event.channel))
      pc.addEventListener('connectionstatechange', () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && !this.closed) {
          this.finish('error', '语音连接已断开。当前字幕已保留，可手动重新开始。')
        }
      })
      this.attachChannel(pc.createDataChannel('recall-events'))
      const offer = await this.wait(pc.createOffer())
      await this.wait(pc.setLocalDescription(offer))
      if (pc.iceGatheringState !== 'complete') {
        await this.wait(new Promise<void>((resolve) => {
          const gathered = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', gathered)
              resolve()
            }
          }
          pc.addEventListener('icegatheringstatechange', gathered)
          gathered()
        }))
      }
      const response = await this.wait(apiFetch('/api/voice/session', {
        method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription?.sdp,
        signal: this.controller.signal,
      }))
      if (!response.ok) {
        const payload = asRecord(await this.wait(response.json().catch(() => null)))
        const message = asRecord(payload.error).message
        throw new Error(typeof message === 'string' ? message : `语音连接失败（${response.status}）。`)
      }
      const sdp = await this.wait(response.text())
      if (!sdp.startsWith('v=0')) throw new Error('语音连接信息无效。请检查本地服务。')
      if (!this.closed) await this.wait(pc.setRemoteDescription({ type: 'answer', sdp }))
    } catch (error) {
      if (this.closed) return
      const message = error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)
        ? '麦克风权限被拒绝，请在浏览器设置中允许访问后重试。'
        : error instanceof DOMException && error.name === 'NotFoundError'
          ? '没有找到可用的麦克风。'
          : error instanceof Error ? error.message : '无法开始语音对话。'
      this.finish('error', message)
    }
  }

  private attachChannel(channel: RTCDataChannel) {
    if (this.closed) { channel.close(); return }
    this.channels.add(channel)
    channel.addEventListener('message', (message) => {
      if (this.closed || typeof message.data !== 'string') return
      let event: Record<string, unknown>
      try { event = asRecord(JSON.parse(message.data)) } catch { return }
      // Qwen creates a separate "txt" channel. Send configuration on the
      // channel delivering session.created, after the server is ready.
      if (!this.configured && event.type === 'session.created' && channel.readyState === 'open') {
        const vad = asRecord(event.session).turn_detection
        const vadType = asRecord(vad).type
        this.initialVAD = vad === null ? 'null' : vad === undefined ? '未返回'
          : typeof vadType === 'string' && VAD_TYPES.has(vadType) ? vadType : '未知类型'
        this.channel = channel
        this.configured = true
        this.configureSession()
        void this.wait(Promise.all(this.senders.map(({ sender, track }) => sender.replaceTrack(track))))
          .catch(() => { if (!this.closed) this.finish('error', '无法恢复麦克风音频发送，请重新开始。') })
      }
      if (channel !== this.channel && event.type !== 'error') return
      this.handleEvent(event)
    })
    channel.addEventListener('close', () => {
      if (channel === this.channel && !this.closed) this.finish('error', '语音控制连接已断开，请手动重新开始。')
    })
  }

  private configureSession() {
    this.send({ type: 'session.update', session: {
      modalities: ['text', 'audio'],
      audio: { output: { voice: 'Tina' } },
      instructions: voiceInstructions(this.options),
      input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
      enable_search: false, max_tokens: 512,
      ...(this.useDefaultVAD ? {} : { turn_detection: { type: 'server_vad', silence_duration_ms: TURN_END_SILENCE_MS } }),
    } })
  }

  private send(event: Record<string, unknown>): boolean {
    if (this.closed || this.channel?.readyState !== 'open') return false
    try { this.channel.send(JSON.stringify(event)); return true } catch {
      this.finish('error', '无法发送语音控制指令，请重新开始。')
      return false
    }
  }

  private handleEvent(event: Record<string, unknown>) {
    if (event.type === 'error') {
      const error = asRecord(event.error)
      if (this.configured && !this.acknowledged && !this.useDefaultVAD && error.type === 'invalid_request_error'
        && typeof error.param === 'string' && TURN_DETECTION_FIELDS.has(error.param)) {
        // Some WebRTC sessions reject overrides. Retry on the same connection before enabling the mic.
        this.useDefaultVAD = true
        this.configureSession()
        return
      }
      // Recover only an explicit cancellation failure after that same response
      // has ended; unrelated or unrecognized provider errors remain fatal.
      if (this.cancellation?.completed && Date.now() - this.cancellation.requestedAt < 5000
        && error.type === 'invalid_request_error' && typeof error.message === 'string'
        && NO_RESPONSE_TO_CANCEL.test(error.message.trim()) && (!error.param || error.param === 'response.cancel')) {
        this.cancellation = undefined
        return
      }
      const stage = this.acknowledged ? '对话阶段' : this.configured ? '会话配置阶段' : '会话建立阶段'
      const diagnostic = this.configured && typeof error.param === 'string' && ERROR_PARAMS.has(error.param)
        && error.param.startsWith('session.turn_detection')
        ? ` 连接诊断 RTC-D1：初始 VAD=${this.initialVAD}；客户端${this.useDefaultVAD ? '未发送' : '已发送'} turn_detection。` : ''
      this.finish('error', serviceErrorNotice(error, stage) + diagnostic)
      return
    }
    if (event.type === 'session.updated' && this.acknowledged) {
      if (this.helpState === 'waiting') {
        if (this.snapshot.phase === 'listening' || this.suspended) this.restoreInstructions()
        else { this.helpState = 'responding'; this.pendingReplies.push(false); this.send({ type: 'response.create' }) }
      } else if (this.helpState === 'restoring') this.helpState = 'idle'
    }
    if (event.type === 'session.updated' && !this.acknowledged) {
      this.acknowledged = true
      clearTimeout(this.timeout)
      this.startedAt = this.activityAt = Date.now()
      this.stream?.getAudioTracks().forEach((track) => { track.enabled = !this.snapshot.muted })
      this.update({ phase: 'ready', notice: this.useDefaultVAD ? '语音服务未接受较长的停顿，已恢复默认断句。' : '' })
      this.interval = setInterval(() => {
        if (this.suspended) return
        this.update({ elapsedSeconds: Math.floor((this.accumulatedMs + Date.now() - this.startedAt) / 1000) })
        if (Date.now() - this.activityAt >= 120_000) this.pause('长时间没有交流，已自动暂停。点击继续对话即可接着聊。')
      }, 500)
      // WebRTC rejects response.create before the first user input. Let VAD
      // start the first reply after the learner speaks.
    }
    if (!this.acknowledged) return
    const discardPending = event.type === 'response.created' ? this.pendingReplies.shift() : false
    if ((this.suspended || discardPending) && event.type === 'response.created') {
      const response = asRecord(event.response)
      this.activeResponseId = typeof response.id === 'string' ? response.id : undefined
      if (this.activeResponseId) this.suspendedResponses.add(this.activeResponseId)
      this.activeResponse = true
      this.cancelResponse()
      return
    }
    if (this.suspended && ['input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped'].includes(String(event.type))) return
    const discarded = this.suspendedResponses.has(String(event.response_id ?? asRecord(event.response).id ?? ''))
    if (discarded && event.type === 'response.created') return
    const turns = discarded ? this.snapshot.turns : this.reduceTranscript(this.snapshot.turns, event)
    if (turns !== this.snapshot.turns) this.update({ turns })
    if (event.type === 'input_audio_buffer.speech_started') {
      this.activityAt = Date.now()
      this.options.audio.pause()
      this.cancelResponse()
      this.update({ phase: 'listening', notice: '' })
    } else if (event.type === 'input_audio_buffer.speech_stopped') {
      this.pendingReplies.push(false)
      this.update({ phase: 'thinking' })
    } else if (event.type === 'response.created') {
      this.activityAt = Date.now()
      this.activeResponse = true
      const response = asRecord(event.response)
      this.activeResponseId = typeof response.id === 'string' ? response.id : undefined
      this.update({ phase: 'speaking' })
      void this.enableAudio()
    } else if (event.type === 'response.done') {
      this.activityAt = Date.now()
      const response = asRecord(event.response)
      if (this.cancellation && response.id === this.cancellation.responseId && ['completed', 'cancelled', 'incomplete'].includes(String(response.status))) this.cancellation.completed = true
      const current = !this.activeResponseId || response.id === this.activeResponseId
      if (current) {
        this.activeResponse = false
        this.activeResponseId = undefined
        if (this.helpState === 'responding') this.restoreInstructions()
      }
      if (current && response.status === 'failed') { this.finish('error', 'AI 回复失败，字幕已保留，请手动重新开始。'); return }
      if (typeof response.id === 'string' && !this.responses.has(response.id)) {
        this.responses.add(response.id)
        const usage = asRecord(response.usage)
        const input = asRecord(usage.input_tokens_details)
        const output = asRecord(usage.output_tokens_details)
        const priced = typeof input.audio_tokens === 'number' && typeof output.audio_tokens === 'number'
        this.update({ usage: {
          inputTokens: this.snapshot.usage.inputTokens + tokenCount(usage.input_tokens),
          outputTokens: this.snapshot.usage.outputTokens + tokenCount(usage.output_tokens),
          estimatedYuan: this.snapshot.usage.estimatedYuan + (tokenCount(input.audio_tokens) * 6 + tokenCount(input.text_tokens) * 1.5 + tokenCount(output.audio_tokens) * 12 + tokenCount(output.text_tokens) * 4.5) / 1_000_000,
          complete: priced && (this.responses.size === 1 || this.snapshot.usage.complete),
        } })
      }
      if (current && this.snapshot.phase !== 'listening' && !this.suspended && !discarded) this.update({ phase: 'ready' })
    }
  }

  setMuted(muted: boolean) {
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = this.acknowledged && !muted && !this.closed && !this.suspended })
    this.update({ muted })
  }

  async enableAudio() {
    if (this.closed || this.suspended) return
    try { await this.options.audio.play(); this.update({ needsAudio: false }) }
    catch { if (!this.suspended) this.update({ needsAudio: true }) }
  }

  private get suspended() { return this.snapshot.phase === 'paused' || this.snapshot.phase === 'resuming' }

  private cancelResponse() {
    if (!this.activeResponse) return
    this.activeResponse = false
    this.cancellation = this.activeResponseId ? { responseId: this.activeResponseId, requestedAt: Date.now(), completed: false } : undefined
    if (this.suspended && this.activeResponseId) this.suspendedResponses.add(this.activeResponseId)
    this.send({ type: 'response.cancel' })
  }

  pause(notice = '对话已暂停，麦克风已关闭。点击继续对话即可接着聊。') {
    if (this.closed || !this.acknowledged || this.snapshot.phase === 'paused') return
    if (!this.suspended) this.accumulatedMs += Date.now() - this.startedAt
    // Keep a separate cancellation marker for each reply still waiting to start.
    this.pendingReplies = this.pendingReplies.map(() => true)
    this.microphoneEpoch++
    clearTimeout(this.timeout)
    this.stream?.getTracks().forEach((track) => { track.enabled = false; track.stop() })
    this.stream = undefined
    this.stopMeter?.(); this.stopMeter = undefined
    this.options.onLevel?.(0)
    this.options.audio.muted = true
    this.options.audio.pause()
    this.options.audio.srcObject = null
    const turns = this.snapshot.turns.map((turn) => (!turn.final || (turn.role === 'assistant' && this.activeResponseId !== undefined && turn.responseId === this.activeResponseId)) ? { ...turn, interrupted: true } : turn)
    this.update({ phase: 'paused', elapsedSeconds: Math.floor(this.accumulatedMs / 1000), needsAudio: false, notice, turns })
    this.cancelResponse()
    this.send({ type: 'input_audio_buffer.clear' })
    if (this.helpState !== 'idle') this.restoreInstructions()
    void Promise.all(this.senders.map(({ sender }) => sender.replaceTrack(null)))
      .catch(() => { if (!this.closed) this.finish('error', '无法暂停音频连接，麦克风已关闭，请重新开始。') })
  }

  async resume() {
    if (this.closed || this.snapshot.phase !== 'paused' || document.visibilityState === 'hidden') return
    const epoch = ++this.microphoneEpoch
    this.update({ phase: 'resuming', notice: '正在恢复麦克风…' })
    this.timeout = setTimeout(() => {
      if (!this.closed && epoch === this.microphoneEpoch) this.pause('恢复麦克风超时，请检查权限后点击继续对话。')
    }, 30_000)
    try {
      const media = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).then((stream) => {
        if (this.closed || epoch !== this.microphoneEpoch) stream.getTracks().forEach((track) => track.stop())
        return stream
      })
      const stream = await this.wait(media)
      if (this.closed || epoch !== this.microphoneEpoch) return
      stream.getAudioTracks().forEach((track) => { track.enabled = false })
      this.stream = stream
      const track = stream.getAudioTracks()[0]
      if (!track) throw new Error('没有找到可用的麦克风。')
      await this.wait(Promise.all(this.senders.map(({ sender }) => sender.replaceTrack(track))))
      if (this.closed || epoch !== this.microphoneEpoch) return
      this.senders = this.senders.map(({ sender }) => ({ sender, track }))
      clearTimeout(this.timeout)
      this.startedAt = this.activityAt = Date.now()
      this.options.audio.srcObject = this.remoteStream ?? null
      this.options.audio.muted = false
      this.update({ phase: 'ready', notice: '' })
      this.setMuted(this.snapshot.muted)
      if (this.options.onLevel) this.stopMeter = monitorMicrophone(stream, this.options.onLevel)
      void this.enableAudio()
    } catch {
      if (!this.closed && epoch === this.microphoneEpoch) this.pause('无法恢复麦克风，请检查浏览器权限后点击继续对话。')
    }
  }

  requestHelp(kind: 'slower' | 'chinese' | 'hint') {
    if (!this.acknowledged || this.closed || this.activeResponse || this.helpState !== 'idle' || this.snapshot.phase !== 'ready') return
    if (!this.snapshot.turns.some(turn => turn.role === 'assistant' && turn.text.trim())) {
      this.update({ notice: '请先开口说一句英语，AI 回复后就可以使用这些帮助。' })
      return
    }
    const instruction = {
      slower: 'For your next reply, repeat your last question slowly in simple English.',
      chinese: 'For your next reply, briefly explain your last question in Chinese, then repeat the English question.',
      hint: 'For your next reply, give a short English sentence starter to help the learner answer your last question. Do not provide a full answer.',
    }[kind]
    this.helpState = 'waiting'
    this.send({ type: 'session.update', session: { instructions: `${voiceInstructions(this.options)}\n${instruction}` } })
  }

  private restoreInstructions() {
    this.helpState = 'restoring'
    this.send({ type: 'session.update', session: { instructions: voiceInstructions(this.options) } })
  }

  private onVisibility = () => {
    if (document.visibilityState !== 'hidden') return
    if (this.acknowledged) this.pause('页面进入后台，已暂停对话。返回后点击继续对话。')
    else this.end('页面进入后台，已取消语音连接。')
  }
  private onPageHide = () => this.end()

  end(notice = '本次对话已结束。') { this.finish('ended', notice) }

  private finish(phase: 'ended' | 'error', notice: string) {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
    clearTimeout(this.timeout)
    clearInterval(this.interval)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('pagehide', this.onPageHide)
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stopMeter?.()
    this.channels.forEach((channel) => channel.close())
    this.pc?.close()
    this.options.audio.pause()
    this.options.audio.srcObject = null
    this.snapshot = { ...this.snapshot, phase, notice, muted: true, needsAudio: false }
    this.options.onChange(this.snapshot)
  }
}
