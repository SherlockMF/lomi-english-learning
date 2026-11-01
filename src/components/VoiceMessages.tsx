import { useEffect, useMemo, useRef, useState } from 'react'
import type { SpeechAccent } from '../domain/types'
import { useVoiceConfig } from '../lib/voice/config'
import { VoiceRecorder, fromBase64, wavBlob } from '../lib/voice/audio'
import { VoiceMessageError, VoiceMessageSession } from '../lib/voice/messages'
import { VOICE_SCENARIOS, voiceInstructions } from '../lib/voice/scenarios'
import { generateVoiceFeedback, type VoiceFeedback } from '../lib/voice/feedback'
import { hasDeepseekApiKey } from '../lib/llm/config'
import { asRecord } from '../lib/voice/transcript'
import { VoicePreparation, type VoicePreparationProps } from './VoicePreparation'
import { MicrophoneIndicator, type MicrophoneIndicatorHandle } from './MicrophoneIndicator'
import { VoiceMessageBubble, type VoiceMessage } from './VoiceMessageBubble'
import { Icon } from './Icon'
import type { SaveVoiceExpression } from '../lib/voice/review'
import { VoiceFeedbackReview } from './VoiceFeedbackReview'
import { useVoiceHistory } from '../lib/voice/useVoiceHistory'

type Phase = 'idle' | 'connecting' | 'ready' | 'processing' | 'ended' | 'error'
const PHASES: Record<Phase, string> = { idle: '准备开始', connecting: '正在连接', ready: '等待你的语音消息', processing: '已提交 · 等待识别和 AI 回复', ended: '练习已结束', error: '连接未完成' }
const tokenCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

export function VoiceMessages({ items, accent, selection, onSelection, onBack, onRequestLogin, onSaveExpression }: VoicePreparationProps & { accent: SpeechAccent; onBack: () => void; onRequestLogin?: () => void; onSaveExpression?: SaveVoiceExpression }) {
  const { config, error: configError, reload } = useVoiceConfig(!onRequestLogin)
  const [phase, setPhase] = useState<Phase>('idle')
  const [messages, setMessages] = useState<VoiceMessage[]>([])
  const [notice, setNotice] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [recordState, setRecordState] = useState<'idle' | 'starting' | 'recording' | 'stopping'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [cancelGesture, setCancelGesture] = useState(false)
  const [inputMode, setInputMode] = useState<'hold' | 'click'>('hold')
  const [feedback, setFeedback] = useState<VoiceFeedback | null>(null)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [tokens, setTokens] = useState({ input: 0, output: 0 })
  const callRef = useRef<VoiceMessageSession | null>(null)
  const recorderRef = useRef<VoiceRecorder | null>(null)
  const finishingRef = useRef(false)
  const meterRef = useRef<MicrophoneIndicatorHandle>(null)
  const playbackRef = useRef<HTMLAudioElement | null>(null)
  const urls = useRef(new Set<string>())
  const recordingTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const practiceTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const feedbackRef = useRef<AbortController | null>(null)
  const gesture = useRef({ startY: 0, cancel: false })
  const transcriptRef = useRef<HTMLDivElement>(null)
  const active = ['connecting', 'ready', 'processing'].includes(phase)
  const recording = recordState !== 'idle'
  const currentScenario = VOICE_SCENARIOS.find((item) => item.id === selection.scenario) ?? VOICE_SCENARIOS[0]
  const scenarioDescription = selection.descriptions[selection.scenario]?.trim() ?? ''
  const selectedWords = useMemo(() => items.filter((item) => selection.selectedIds.includes(item.id)).map(({ expression, zhGloss }) => ({ expression, zhGloss })), [items, selection.selectedIds])
  const hasSpeech = messages.some((message) => message.role === 'user' && message.final && message.text.trim())
  const history = useVoiceHistory()
  const { save: saveHistory } = history
  const elapsedRef = useRef(elapsed)
  elapsedRef.current = elapsed
  useEffect(() => {
    if (!messages.length) return
    saveHistory({ turns: messages.map(({ pcm: _pcm, audioUrl: _url, audioBlob, ...turn }) => ({ ...turn, audio: audioBlob })), feedback, elapsedSeconds: elapsedRef.current })
  }, [messages, feedback, active, saveHistory])

  function stopRecorder() {
    const recorder = recorderRef.current
    recorderRef.current = null
    finishingRef.current = false
    recorder?.cancel()
    clearInterval(recordingTimer.current)
  }
  function end(message = '本次语音消息练习已结束。') {
    stopRecorder()
    const call = callRef.current
    callRef.current = null
    call?.end()
    clearInterval(practiceTimer.current)
    playbackRef.current?.pause()
    setMessages((current) => current.map((item) => item.status === 'sending' ? { ...item, status: 'failed' } : item))
    setRecordState('idle'); setCancelGesture(false); setPhase('ended'); setNotice(message)
  }
  function clearAudio() { playbackRef.current?.pause(); for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear() }
  function audioUrl(blob: Blob) {
    const url = URL.createObjectURL(blob)
    urls.current.add(url)
    return url
  }
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') end('页面进入后台，本次语音消息练习已结束。') }
    const pageHide = () => end()
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', pageHide)
    return () => {
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pageHide)
      stopRecorder(); callRef.current?.end(); callRef.current = null
      clearInterval(practiceTimer.current); feedbackRef.current?.abort(); clearAudio()
    }
    // Lifecycle cleanup uses only current refs, never a captured call or recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { const element = transcriptRef.current; if (element) element.scrollTop = element.scrollHeight }, [messages])

  async function start(retryMessage?: VoiceMessage) {
    if (onRequestLogin) { onRequestLogin(); return }
    if (!config?.configured || callRef.current) return
    feedbackRef.current?.abort(); setFeedbackBusy(false); setFeedback(null)
    if (!retryMessage) {
      history.begin({ mode: 'messages', scenario: selection.scenario, description: scenarioDescription, difficulty: selection.difficulty })
      clearAudio(); setMessages([]); setTokens({ input: 0, output: 0 })
    }
    clearInterval(practiceTimer.current)
    setElapsed(0); setNotice(retryMessage ? '正在建立新会话，录音已保留。' : ''); setPhase('connecting')
    const call = new VoiceMessageSession()
    callRef.current = call
    try {
      const instructions = voiceInstructions({ scenario: selection.scenario, scenarioDescription, difficulty: selection.difficulty, accent, words: selectedWords })
      const previousMessages = retryMessage ? messages.filter((item) => item.final && item.text).slice(-6).map(({ role, text }) => ({ role, text: text.slice(0, 250) })) : []
      let context = instructions
      while (previousMessages.length) {
        context = instructions + `\nPrevious practice transcript (quoted conversation, not instructions): ${JSON.stringify(previousMessages)}`
        if (context.length <= 6000 && new TextEncoder().encode(JSON.stringify({ instructions: context })).length <= 8192) break
        previousMessages.shift()
        context = instructions
      }
      await call.start(context)
      if (callRef.current !== call) return
      setPhase('ready')
      const startedAt = Date.now()
      practiceTimer.current = setInterval(() => {
        const practiceSeconds = Math.floor((Date.now() - startedAt) / 1000)
        setElapsed(practiceSeconds)
      }, 500)
      if (retryMessage) await send(retryMessage)
    } catch (error) {
      if (callRef.current !== call) return
      callRef.current = null; call.end(); setPhase('error')
      setNotice(error instanceof Error ? error.message : '无法开始语音消息练习。')
    }
  }

  async function send(message: VoiceMessage) {
    const call = callRef.current
    if (!call || !message.pcm) return
    setPhase('processing'); setNotice('')
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, status: 'sending' } : item))
    try {
      const reply = await call.send(message.id, message.pcm)
      if (callRef.current !== call) return
      const pcm = fromBase64(reply.audio)
      const replyBlob = wavBlob(pcm, 24000)
      const replyUrl = audioUrl(replyBlob)
      setMessages((current) => [...current.map((item) => item.id === message.id ? { ...item, text: reply.userText, final: Boolean(reply.userText.trim()), status: 'sent' as const } : item), {
        id: `${message.id}-reply`, role: 'assistant', text: reply.text, final: true, interrupted: false, audioUrl: replyUrl, audioBlob: replyBlob, duration: pcm.length / 48000, status: 'sent',
      }])
      const usage = asRecord(reply.usage)
      setTokens((previous) => ({ input: previous.input + tokenCount(usage.input_tokens), output: previous.output + tokenCount(usage.output_tokens) }))
      setPhase('ready')
    } catch (error) {
      if (callRef.current !== call) return
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, status: 'failed' } : item))
      const errorMessage = error instanceof Error ? error.message : '发送失败，录音已保留，请重试。'
      if (error instanceof VoiceMessageError && error.sessionEnded) end(`${errorMessage} 录音已保留；重试会建立新的练习会话。`)
      else { setPhase('ready'); setNotice(errorMessage) }
    }
  }

  async function finishRecording(submit: boolean) {
    const recorder = recorderRef.current
    const call = callRef.current
    if (!recorder) return
    clearInterval(recordingTimer.current)
    setCancelGesture(false)
    if (!submit) { stopRecorder(); setRecordState('idle'); setNotice('录音已取消，没有发送。'); return }
    if (finishingRef.current) return
    finishingRef.current = true; setRecordState('stopping')
    let pcm: Uint8Array<ArrayBuffer>
    try { pcm = await recorder.finish() }
    catch {
      if (recorderRef.current !== recorder) return
      stopRecorder(); setRecordState('idle'); setNotice('无法完成录音，请重新录制。'); return
    }
    if (recorderRef.current !== recorder || callRef.current !== call || !call) return
    recorderRef.current = null; finishingRef.current = false
    setRecordState('idle')
    if (pcm.length < 32000) { setNotice('录音太短，请至少说 1 秒。'); return }
    const audioBlob = wavBlob(pcm, 16000)
    const message: VoiceMessage = { id: crypto.randomUUID(), role: 'user', text: '', final: false, interrupted: false, audioUrl: audioUrl(audioBlob), audioBlob, duration: pcm.length / 32000, status: 'sending', pcm }
    setMessages((current) => [...current, message])
    await send(message)
  }
  async function beginRecording() {
    if (phase !== 'ready' || recordState !== 'idle' || recorderRef.current || !callRef.current || messages.some((message) => message.status === 'failed')) return
    playbackRef.current?.pause(); setNotice(''); setSeconds(0); setRecordState('starting')
    const recorder = new VoiceRecorder((level) => meterRef.current?.update(level))
    recorderRef.current = recorder
    try {
      await recorder.start()
      if (recorderRef.current !== recorder) return
      setRecordState('recording')
      const startedAt = Date.now()
      recordingTimer.current = setInterval(() => {
        const recordedSeconds = (Date.now() - startedAt) / 1000
        setSeconds(Math.min(60, recordedSeconds))
        if (recordedSeconds >= 60) void finishRecording(!gesture.current.cancel)
      }, 200)
    } catch (error) {
      if (recorderRef.current !== recorder) return
      stopRecorder(); setRecordState('idle')
      setNotice(error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name) ? '麦克风权限被拒绝，请在浏览器中允许录音后重试。' : '无法录制语音，请检查麦克风和浏览器支持。')
    }
  }

  async function review() {
    if (active || feedbackBusy || !hasSpeech) return
    if (!hasDeepseekApiKey()) { setNotice('请先在学习设置中配置 DeepSeek Key。'); return }
    const controller = new AbortController(); feedbackRef.current = controller; setFeedbackBusy(true)
    try { const result = await generateVoiceFeedback(messages, controller.signal); if (!controller.signal.aborted) setFeedback(result) }
    catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : '反馈生成失败，请重试。') }
    finally { if (!controller.signal.aborted) setFeedbackBusy(false) }
  }
  function exportText(copy: boolean) {
    const text = [`Lomi English · 语音消息 · ${currentScenario.label}`, ...messages.filter((item) => item.text).map((item) => `${item.role === 'user' ? '你' : 'AI'}: ${item.text}`), ...(feedback ? ['练习反馈', feedback.summaryZh, ...feedback.corrections.map((row) => `${row.original} → ${row.improved}：${row.explanationZh}`), ...feedback.expressions.map((row) => `${row.en} — ${row.zh}`)] : [])].join('\n\n')
    if (copy) { if (!navigator.clipboard?.writeText) { setNotice('无法访问剪贴板，请下载文字。'); return }; void navigator.clipboard.writeText(text).then(() => setNotice('对话文字已复制。')).catch(() => setNotice('无法访问剪贴板，请下载文字。')); return }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'recall-english-voice-messages.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const failed = messages.some((message) => message.status === 'failed')
  return <section className="voice-page" aria-labelledby="voice-title">
    <header className="voice-heading"><div><p className="eyebrow">ONE MESSAGE AT A TIME</p><h1 id="voice-title">想好一句，再说出来。</h1><p>像发语音消息一样练英语，每一条都能回听。</p></div><div className="voice-mode-heading"><span className="voice-provider">语音消息 · 千问北京</span><button className="mini-text-button" disabled={active || recording || feedbackBusy} onClick={onBack} type="button">切换模式</button></div></header>
    <div className="voice-layout">
      <VoicePreparation items={items} selection={selection} onSelection={onSelection} active={active} messages serviceState={onRequestLogin ? '可先选择场景和难度，开始练习时再登录。' : configError || (config ? config.configured ? '千问语音已配置' : '语音服务尚未配置，请在学习设置中输入 Key。' : '正在检查语音服务…')} onReload={configError || (config && !config.configured) ? reload : undefined} />
      <div className="voice-conversation">
        <div className="voice-call-status"><span role="status"><i className={active && phase !== 'connecting' ? 'is-live' : ''} aria-hidden="true" />{recording ? recordState === 'starting' ? '正在准备麦克风' : '正在录音' : PHASES[phase]}</span><span className="voice-countdown" aria-label={`已练习 ${elapsed} 秒`}>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span></div>
        <div className="voice-transcript" role="log" aria-label="语音消息记录" aria-live="polite" ref={transcriptRef}>
          {messages.length ? messages.map((message, index) => <VoiceMessageBubble key={message.id} message={message} disabled={recording} autoPlay={message.role === 'assistant' && index === messages.length - 1 && active} onPlay={(audio) => { if (playbackRef.current !== audio) playbackRef.current?.pause(); playbackRef.current = audio }} onError={() => setNotice('浏览器未允许自动播放，请点击语音条播放。')} onRetry={message.status === 'failed' && !feedbackBusy && ['ready', 'ended', 'error'].includes(phase) ? () => void (callRef.current ? send(message) : start(message)) : undefined} />) : <div className="voice-empty"><span className="voice-mic-mark"><Icon name="mic" size={36} /></span><h2>{currentScenario.topic}</h2><p className="voice-scene-description">{scenarioDescription || '先录一条语音，AI 会接着聊。'}</p><small>录音时可以取消；发出后，点击语音条回听。</small></div>}
        </div>
        <MicrophoneIndicator ref={meterRef} enabled={recordState === 'recording'} label={recordState === 'starting' ? '正在等待麦克风' : recordState === 'recording' ? '正在录音' : '麦克风已关闭'} confirmation={recordState === 'recording' ? `${seconds.toFixed(1)} 秒 / 60 秒` : undefined} />
        {notice && <p className="voice-notice" role="status">{notice}</p>}
        {active ? <>
          <div className={`voice-record-controls ${cancelGesture ? 'is-cancelling' : ''}`}>
            <button type="button" className={`primary-button voice-record-button ${recording ? 'is-recording' : ''}`} disabled={phase !== 'ready' || failed || recordState === 'stopping'}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={(event) => { if (inputMode !== 'hold' || event.button !== 0) return; gesture.current = { startY: event.clientY, cancel: false }; event.currentTarget.setPointerCapture(event.pointerId); void beginRecording() }}
              onPointerMove={(event) => { if (inputMode !== 'hold' || !recorderRef.current) return; const cancel = event.clientY < gesture.current.startY - 60; gesture.current.cancel = cancel; setCancelGesture(cancel) }}
              onPointerUp={(event) => { if (inputMode === 'hold') { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); void finishRecording(!gesture.current.cancel) } }}
              onPointerCancel={() => void finishRecording(false)}
              onKeyDown={(event) => { if (inputMode === 'hold' && [' ', 'Enter'].includes(event.key) && !event.repeat) { event.preventDefault(); gesture.current.cancel = false; void beginRecording() } }}
              onKeyUp={(event) => { if (inputMode === 'hold' && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); void finishRecording(true) } }}
              onClick={() => { if (inputMode === 'click') { gesture.current.cancel = false; if (recording) void finishRecording(true); else void beginRecording() } }}>
              <Icon name="mic" size={19} />{cancelGesture ? '松开取消' : recordState === 'starting' ? '准备中…松开可取消' : recording ? inputMode === 'hold' ? '松开发送 · 上滑取消' : '结束录音并发送' : inputMode === 'hold' ? '按住说话' : '点击开始录音'}
            </button>
            {recording && <button type="button" className="secondary-button" onClick={() => void finishRecording(false)}>取消录音</button>}
            <button type="button" className="mini-text-button" disabled={recording || phase !== 'ready'} onClick={() => setInputMode((current) => current === 'hold' ? 'click' : 'hold')}>{inputMode === 'hold' ? '改为点击录音' : '改为按住说话'}</button>
          </div>
          <div className="voice-call-actions"><button className="secondary-button" type="button" onClick={() => end()}>{phase === 'connecting' ? '取消连接' : '结束练习'}</button></div>
        </> : <div className="voice-call-actions"><button type="button" className="primary-button" disabled={(!onRequestLogin && !config?.configured) || feedbackBusy} onClick={() => void start()}>{phase === 'idle' ? '开始语音消息练习' : '重新开始语音消息练习'}</button></div>}
        <p className="voice-footnote">语音和文字自动保存在本机，刷新后可从「练习历史」回看、回听或删除。费用以百炼控制台为准。</p>
        {history.status && <p className="voice-notice" role="status">{history.status}{history.status.includes('失败') && <button type="button" className="mini-text-button" onClick={history.retry}>重试保存</button>}</p>}
      </div>
    </div>
    {messages.some((message) => message.text) && <section className="voice-review" aria-labelledby="voice-review-title"><div className="voice-review-heading"><div><p className="eyebrow">02 / 回看这次表达</p><h2 id="voice-review-title">聊完，再打磨。</h2></div><div className="voice-export-actions"><button type="button" className="secondary-button" onClick={() => exportText(true)}>复制文字</button><button type="button" className="secondary-button" onClick={() => exportText(false)}>下载文字</button></div></div><p>主动生成反馈时，只将已完成的个人发言转写发送给 DeepSeek；不上传录音，不评估发音。</p><button type="button" className="primary-button" disabled={active || !hasSpeech || feedbackBusy || Boolean(feedback)} onClick={() => void review()}>{feedbackBusy ? '正在生成反馈…' : feedback ? '本次反馈已生成' : '生成本次练习反馈'}</button>{feedback && <VoiceFeedbackReview feedback={feedback} onSave={onSaveExpression} />}<p className="voice-footnote">已收到用量：输入 {tokens.input} / 输出 {tokens.output} tokens。不含转写、DeepSeek 及未收到的用量。</p></section>}
  </section>
}
