import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceSession } from './session'

class Channel extends EventTarget {
  readyState = 'open'
  label = 'txt'
  sent: Record<string, unknown>[] = []
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 'closed' }
  event(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })) }
}
class Peer extends EventTarget {
  static instances: Peer[] = []
  connectionState = 'new'
  iceGatheringState = 'complete'
  localDescription = { sdp: 'v=0\r\nm=audio 9 RTP/AVP 0\r\n' }
  channel = new Channel()
  sender = { replaceTrack: vi.fn().mockResolvedValue(undefined) }
  addTrack = vi.fn(() => this.sender)
  close = vi.fn(() => { this.connectionState = 'closed' })
  createDataChannel() { return this.channel }
  createOffer = vi.fn(async () => this.localDescription)
  setLocalDescription = vi.fn(async () => undefined)
  setRemoteDescription = vi.fn(async () => undefined)
  constructor() { super(); Peer.instances.push(this) }
}
const track = { enabled: true, stop: vi.fn() }
const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
let getMedia: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>
let audio: HTMLAudioElement

beforeEach(() => {
  Peer.instances = []
  track.enabled = true
  track.stop.mockClear()
  getMedia = vi.fn().mockResolvedValue(stream)
  vi.stubGlobal('RTCPeerConnection', Peer)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: getMedia } })
  request = vi.fn().mockResolvedValue(new Response('v=0\r\nm=audio 9 RTP/AVP 0\r\n'))
  vi.stubGlobal('fetch', request)
  audio = document.createElement('audio')
  audio.play = vi.fn().mockResolvedValue(undefined)
  audio.pause = vi.fn()
})
afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  vi.unstubAllGlobals(); vi.useRealTimers()
})

function session() {
  return new VoiceSession({ audio, scenario: 'daily', difficulty: 'basic', words: [], onChange: vi.fn() })
}
async function ready(call: VoiceSession) {
  await call.start()
  const pc = Peer.instances[0]
  pc.channel.event({ type: 'session.created' })
  expect(track.enabled).toBe(false)
  pc.channel.event({ type: 'session.updated' })
  return pc
}

describe('voice lifecycle', () => {
  it('waits for session.created before configuring and restoring the blocked sender', async () => {
    const call = session()
    await call.start()
    const pc = Peer.instances[0]
    expect(pc.sender.replaceTrack).toHaveBeenCalledWith(null)
    pc.channel.event({ type: 'rate_limits.updated' })
    expect(pc.channel.sent).toHaveLength(0)
    expect(pc.sender.replaceTrack).toHaveBeenCalledTimes(1)
    pc.channel.event({ type: 'session.created' })
    expect(pc.sender.replaceTrack).toHaveBeenLastCalledWith(track)
    expect(track.enabled).toBe(false)
    expect(pc.channel.sent[0].type).toBe('session.update')
    pc.channel.event({ type: 'session.created' })
    expect(pc.sender.replaceTrack).toHaveBeenCalledTimes(2)
    expect(pc.channel.sent).toHaveLength(1)
    pc.channel.event({ type: 'session.updated' })
    expect(track.enabled).toBe(true)
    call.end()
  })

  it('shows the rejected session field without exposing the provider message', async () => {
    const call = session()
    await call.start()
    const pc = Peer.instances[0]
    pc.channel.event({ type: 'session.created' })
    pc.channel.event({ type: 'error', error: {
      type: 'invalid_request_error', code: 'invalid_value', param: 'session.audio.output.voice',
      message: 'Invalid voice. Bearer sk-test-private-do-not-display',
    } })
    expect(call.snapshot.phase).toBe('error')
    expect(call.snapshot.notice).toContain('会话配置')
    expect(call.snapshot.notice).toContain('invalid_value')
    expect(call.snapshot.notice).toContain('session.audio.output.voice')
    expect(call.snapshot.notice).not.toContain('sk-test-private')
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('distinguishes conversation errors and omits unrecognized diagnostic values', async () => {
    const call = session()
    const pc = await ready(call)
    pc.channel.event({ type: 'error', error: {
      type: 'server_error', code: 'sk-test-private', param: 'https://private.example/token', message: 'private provider data',
    } })
    expect(call.snapshot.notice).toContain('对话阶段')
    expect(call.snapshot.notice).toContain('server_error')
    expect(call.snapshot.notice).not.toMatch(/private|https:/)
    expect(call.snapshot.phase).toBe('error')
  })

  it.each([
    [null, 'null'],
    [undefined, '未返回'],
    [{ type: 'server_vad' }, 'server_vad'],
    [{ type: 'semantic_vad' }, 'semantic_vad'],
    [{ type: 'semantic_vad_ec' }, 'semantic_vad_ec'],
    [{ type: 'private-session-value' }, '未知类型'],
  ])('reports a safe initial VAD state for rejected default configuration: %j', async (vad, expected) => {
    const call = session()
    await call.start()
    const pc = Peer.instances[0]
    pc.channel.event({ type: 'session.created', session: { turn_detection: vad, id: 'private-session-id' } })
    const rejection = { type: 'error', error: {
      type: 'invalid_request_error', param: 'session.turn_detection', message: 'private-provider-message',
    } }
    pc.channel.event(rejection)
    pc.channel.event(rejection)
    expect(call.snapshot.notice).toContain('RTC-D1')
    expect(call.snapshot.notice).toContain(`初始 VAD=${expected}`)
    expect(call.snapshot.notice).toContain('客户端未发送 turn_detection')
    expect(call.snapshot.notice).not.toContain('private')
    expect(pc.channel.sent).toHaveLength(2)
    expect(pc.channel.sent[1].session).not.toHaveProperty('turn_detection')
    expect(track.enabled).toBe(false)
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('configures a longer server-side speaking pause before enabling capture', async () => {
    const call = session()
    await call.start()
    const pc = Peer.instances[0]
    const txt = new Channel()
    pc.dispatchEvent(Object.assign(new Event('datachannel'), { channel: txt }))
    txt.event({ type: 'session.created' })
    expect(txt.sent[0]).toMatchObject({ type: 'session.update', session: {
      input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
      turn_detection: { type: 'server_vad', silence_duration_ms: 1600 },
    } })
    expect(track.enabled).toBe(false)
    txt.event({ type: 'session.updated' })
    expect(track.enabled).toBe(true)
    expect(call.snapshot.phase).toBe('ready')
    expect(txt.sent.some(event => event.type === 'response.create')).toBe(false)
    call.end()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(pc.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the call usable if the provider rejects the longer silence window', async () => {
    const call = session()
    await call.start()
    const pc = Peer.instances[0]
    pc.channel.event({ type: 'session.created' })
    pc.channel.event({ type: 'error', error: { type: 'invalid_request_error', param: 'session.turn_detection.silence_duration_ms' } })
    expect(track.enabled).toBe(false)
    expect(call.snapshot.phase).toBe('connecting')
    expect(pc.channel.sent[1]).toMatchObject({ type: 'session.update', session: { instructions: expect.any(String) } })
    expect(pc.channel.sent[1].session).not.toHaveProperty('turn_detection')
    pc.channel.event({ type: 'session.updated' })
    expect(call.snapshot.phase).toBe('ready')
    expect(call.snapshot.notice).toContain('默认断句')
    expect(track.enabled).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    call.end()
  })

  it('releases a late microphone permission result after cancelling connection setup', async () => {
    let resolve!: (value: unknown) => void
    getMedia.mockReturnValue(new Promise((done) => { resolve = done }))
    const call = session()
    const starting = call.start()
    call.end()
    resolve(stream)
    await starting
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(Peer.instances).toHaveLength(0)
    expect(call.snapshot.phase).toBe('ended')
  })

  it('waits for user speech instead of generating a response with empty conversation history', async () => {
    const call = session()
    const pc = await ready(call)
    expect(pc.channel.sent.map(event => event.type)).toEqual(['session.update'])
    expect(track.enabled).toBe(true)
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'first-user' })
    pc.channel.event({ type: 'input_audio_buffer.speech_stopped' })
    pc.channel.event({ type: 'response.created', response: { id: 'first-reply' } })
    pc.channel.event({ type: 'response.audio_transcript.done', item_id: 'answer', response_id: 'first-reply', transcript: 'Hello. How can I help?' })
    pc.channel.event({ type: 'response.done', response: { id: 'first-reply', status: 'completed' } })
    expect(call.snapshot.phase).toBe('ready')
    expect(call.snapshot.turns.some(turn => turn.text === 'Hello. How can I help?')).toBe(true)
    expect(pc.channel.sent.some(event => event.type === 'response.create')).toBe(false)
    call.end()
  })

  it.each(['slower', 'chinese', 'hint'] as const)('does not request %s help before the first assistant reply', async kind => {
    const call = session()
    const pc = await ready(call)
    pc.channel.sent = []
    call.requestHelp(kind)
    expect(pc.channel.sent).toHaveLength(0)
    expect(call.snapshot.phase).toBe('ready')
    expect(call.snapshot.notice).toContain('请先开口')
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'first-user' })
    expect(call.snapshot.notice).toBe('')
    call.end()
  })

  it('ignores a late SDP answer after the user ends the call', async () => {
    let resolve!: (value: Response) => void
    request.mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    const call = session()
    const starting = call.start()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    call.end()
    resolve(new Response('v=0'))
    await starting
    expect(Peer.instances[0].setRemoteDescription).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('mutes capture and stops playback when the user interrupts an active response', async () => {
    const call = session()
    const pc = await ready(call)
    call.setMuted(true)
    expect(track.enabled).toBe(false)
    call.setMuted(false)
    pc.channel.event({ type: 'response.created', response: { id: 'r' } })
    pc.channel.event({ type: 'response.audio_transcript.delta', item_id: 'a', response_id: 'r', delta: 'Hello' })
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'u' })
    expect(audio.pause).toHaveBeenCalled()
    expect(pc.channel.sent.at(-1)?.type).toBe('response.cancel')
    expect(call.snapshot.turns[0].interrupted).toBe(true)
    call.end()
  })

  it('continues past five minutes until the user ends the call', async () => {
    vi.useFakeTimers()
    const call = session()
    const pc = await ready(call)
    const activity = setInterval(() => pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: String(Date.now()) }), 59_000)
    await vi.advanceTimersByTimeAsync(600_000)
    clearInterval(activity)
    expect(call.snapshot.phase).toBe('listening')
    expect(call.snapshot.elapsedSeconds).toBe(600)
    expect(track.stop).not.toHaveBeenCalled()
    call.end()
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('pauses when the page moves to the background and only resumes on request', async () => {
    const call = session()
    await ready(call)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(call.snapshot.phase).toBe('paused')
    expect(track.stop).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(call.snapshot.phase).toBe('paused')
    await call.resume()
    expect(call.snapshot.phase).toBe('ready')
    call.end()
  })

  it('releases capture, blocks late playback, freezes time, and resumes the same conversation', async () => {
    vi.useFakeTimers()
    const call = session()
    const pc = await ready(call)
    pc.channel.event({ type: 'response.created', response: { id: 'r' } })
    pc.channel.event({ type: 'response.audio_transcript.done', item_id: 'a', response_id: 'r', transcript: 'Hello.' })
    await vi.advanceTimersByTimeAsync(10_000)
    call.setMuted(true)
    call.pause()
    expect(call.snapshot.phase).toBe('paused')
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(audio.paused).toBe(true)
    expect(audio.muted).toBe(true)
    expect(pc.close).not.toHaveBeenCalled()
    expect(pc.channel.sent.some((event) => event.type === 'response.cancel')).toBe(true)
    const played = vi.mocked(audio.play).mock.calls.length
    pc.channel.event({ type: 'response.created', response: { id: 'late' } })
    pc.channel.event({ type: 'response.done', response: { id: 'r', status: 'cancelled' } })
    await call.enableAudio()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(audio.play).toHaveBeenCalledTimes(played)
    expect(call.snapshot.phase).toBe('paused')
    expect(call.snapshot.elapsedSeconds).toBe(10)
    await call.resume()
    expect(getMedia).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(1)
    expect(track.enabled).toBe(false)
    expect(call.snapshot.muted).toBe(true)
    expect(call.snapshot.turns[0].text).toBe('Hello.')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(call.snapshot.elapsedSeconds).toBe(15)
    call.end()
  })

  it('stops a late microphone result after ending a pending resume', async () => {
    const call = session()
    await ready(call)
    call.pause()
    let resolve!: (value: unknown) => void
    getMedia.mockReturnValue(new Promise((done) => { resolve = done }))
    const resuming = call.resume()
    call.end()
    const lateTrack = { enabled: true, stop: vi.fn() }
    resolve({ getAudioTracks: () => [lateTrack], getTracks: () => [lateTrack] })
    await resuming
    expect(lateTrack.stop).toHaveBeenCalledTimes(1)
    expect(call.snapshot.phase).toBe('ended')
  })

  it('automatically pauses an idle call and can recover from denied resume permission', async () => {
    vi.useFakeTimers()
    const call = session()
    await ready(call)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(call.snapshot.phase).toBe('paused')
    expect(track.stop).toHaveBeenCalledTimes(1)
    getMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    await call.resume()
    expect(call.snapshot.phase).toBe('paused')
    expect(call.snapshot.notice).toContain('权限')
    await call.resume()
    expect(call.snapshot.phase).toBe('ready')
    expect(track.enabled).toBe(true)
    call.end()
  })

  it('does not request a help reply when paused while waiting for its settings acknowledgement', async () => {
    const call = session()
    const pc = await ready(call)
    pc.channel.event({ type: 'response.audio_transcript.done', item_id: 'greeting-text', transcript: 'How are you?' })
    call.requestHelp('chinese')
    call.pause()
    const responses = pc.channel.sent.filter((event) => event.type === 'response.create').length
    pc.channel.event({ type: 'session.updated' })
    expect(pc.channel.sent.filter((event) => event.type === 'response.create')).toHaveLength(responses)
    expect(call.snapshot.phase).toBe('paused')
    call.end()
  })

  it('discards a pending pre-pause reply even when it arrives after capture has resumed', async () => {
    const call = session()
    const pc = await ready(call)
    pc.channel.event({ type: 'response.created', response: { id: 'greeting' } })
    pc.channel.event({ type: 'response.done', response: { id: 'greeting', status: 'completed' } })
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'old-user' })
    pc.channel.event({ type: 'input_audio_buffer.speech_stopped' })
    call.pause()
    await call.resume()
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'new-user' })
    pc.channel.event({ type: 'input_audio_buffer.speech_stopped' })
    const played = vi.mocked(audio.play).mock.calls.length
    pc.channel.event({ type: 'response.created', response: { id: 'old-reply' } })
    pc.channel.event({ type: 'response.audio_transcript.done', response_id: 'old-reply', item_id: 'old-answer', transcript: 'Old reply after resume' })
    pc.channel.event({ type: 'response.done', response: { id: 'old-reply', status: 'cancelled' } })
    expect(audio.play).toHaveBeenCalledTimes(played)
    expect(pc.channel.sent.at(-1)?.type).toBe('response.cancel')
    expect(call.snapshot.turns.some((turn) => turn.text === 'Old reply after resume')).toBe(false)
    expect(call.snapshot.phase).toBe('thinking')
    call.pause()
    await call.resume()
    pc.channel.event({ type: 'response.created', response: { id: 'new-reply' } })
    expect(call.snapshot.phase).toBe('ready')
    expect(pc.channel.sent.at(-1)?.type).toBe('response.cancel')
    pc.channel.event({ type: 'response.done', response: { id: 'new-reply', status: 'cancelled' } })
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'third-user' })
    pc.channel.event({ type: 'input_audio_buffer.speech_stopped' })
    pc.channel.event({ type: 'response.created', response: { id: 'third-reply' } })
    expect(call.snapshot.phase).toBe('speaking')
    call.end()
  })

  it('waits for help instructions to be acknowledged and restores the scenario afterward', async () => {
    const call = session()
    const pc = await ready(call)
    pc.channel.event({ type: 'response.created', response: { id: 'greeting' } })
    pc.channel.event({ type: 'response.audio_transcript.done', item_id: 'greeting-text', response_id: 'greeting', transcript: 'How are you?' })
    pc.channel.event({ type: 'response.done', response: { id: 'greeting', status: 'completed' } })
    pc.channel.sent = []
    call.requestHelp('chinese')
    call.requestHelp('hint')
    expect(pc.channel.sent).toHaveLength(1)
    expect(pc.channel.sent[0].type).toBe('session.update')
    pc.channel.event({ type: 'session.updated' })
    expect(pc.channel.sent.at(-1)?.type).toBe('response.create')
    pc.channel.event({ type: 'response.created', response: { id: 'help' } })
    pc.channel.event({ type: 'response.done', response: { id: 'help', status: 'completed' } })
    expect(pc.channel.sent.at(-1)?.type).toBe('session.update')
    expect(JSON.stringify(pc.channel.sent.at(-1))).not.toContain('briefly explain your last question in Chinese')
    call.end()
  })

  it('does not let a cancelled older response reset a newer reply', async () => {
    const call = session()
    const pc = await ready(call)
    pc.channel.event({ type: 'response.created', response: { id: 'old' } })
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'u' })
    pc.channel.event({ type: 'response.created', response: { id: 'new' } })
    pc.channel.event({ type: 'response.done', response: { id: 'old', status: 'cancelled' } })
    expect(call.snapshot.phase).toBe('speaking')
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'u2' })
    expect(pc.channel.sent.filter((event) => event.type === 'response.cancel')).toHaveLength(2)
    call.end()
  })

  it('keeps the call only when a late error explicitly says the completed reply cannot be cancelled', async () => {
    const call = session()
    const pc = await ready(call)
    pc.channel.event({ type: 'response.created', response: { id: 'old' } })
    pc.channel.event({ type: 'input_audio_buffer.speech_started', item_id: 'u' })
    pc.channel.event({ type: 'response.done', response: { id: 'old', status: 'completed' } })
    pc.channel.event({ type: 'error', error: { type: 'invalid_request_error', message: 'No active response to cancel.' } })
    expect(call.snapshot.phase).toBe('listening')
    expect(track.stop).not.toHaveBeenCalled()
    pc.channel.event({ type: 'error', error: { type: 'invalid_request_error', param: 'session.modalities', message: 'Invalid modalities.' } })
    expect(call.snapshot.phase).toBe('error')
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('times out microphone setup and stops a subsequently granted stream', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    getMedia.mockReturnValue(new Promise((done) => { resolve = done }))
    const call = session()
    const starting = call.start()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(call.snapshot.phase).toBe('error')
    resolve(stream)
    await starting
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})
