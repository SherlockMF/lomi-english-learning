import { useEffect, useMemo, useRef, useState } from 'react'
import type { SpeechAccent, SystemListSlug, VocabularyItem } from '../domain/types'
import { hasDeepseekApiKey } from '../lib/llm/config'
import { useVoiceConfig } from '../lib/voice/config'
import { generateVoiceFeedback, type VoiceFeedback } from '../lib/voice/feedback'
import { VOICE_SCENARIOS } from '../lib/voice/scenarios'
import { EMPTY_VOICE_SNAPSHOT, VoiceSession, type VoiceSnapshot } from '../lib/voice/session'
import { Icon } from './Icon'
import { VoicePreparation, DEFAULT_VOICE_SELECTION, type VoicePreparationProps } from './VoicePreparation'
import { MicrophoneIndicator, type MicrophoneIndicatorHandle } from './MicrophoneIndicator'
import { VoiceMessages } from './VoiceMessages'
import { VoiceTurnFeedback } from './VoiceTurnFeedback'
import type { SaveVoiceExpression } from '../lib/voice/review'
import { VoiceFeedbackReview } from './VoiceFeedbackReview'
import { useVoiceHistory } from '../lib/voice/useVoiceHistory'
import { VoiceHistory } from './VoiceHistory'

const PHASE_LABELS: Record<VoiceSnapshot['phase'], string> = {
  idle: '准备开始', connecting: '正在连接', ready: '对话已连接', listening: '正在听你说', thinking: 'AI 正在思考', speaking: 'AI 正在回复', paused: '对话已暂停', resuming: '正在恢复麦克风', ended: '练习已结束', error: '连接未完成',
}

function RealtimeVoicePractice({ items, accent, selection, onSelection, onBack, onRequestLogin, onSaveExpression }: VoicePreparationProps & { accent: SpeechAccent; onBack: () => void; onRequestLogin?: () => void; onSaveExpression?: SaveVoiceExpression }) {
  const { config, error: configError, reload } = useVoiceConfig(!onRequestLogin)
  const { scenario, difficulty, selectedIds } = selection
  const [snapshot, setSnapshot] = useState(EMPTY_VOICE_SNAPSHOT)
  const [feedback, setFeedback] = useState<VoiceFeedback | null>(null)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [message, setMessage] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const sessionRef = useRef<VoiceSession | null>(null)
  const feedbackRef = useRef<AbortController | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const transcriptContentRef = useRef<HTMLDivElement>(null)
  const meterRef = useRef<MicrophoneIndicatorHandle>(null)
  const active = !['idle', 'ended', 'error'].includes(snapshot.phase)
  const suspended = snapshot.phase === 'paused' || snapshot.phase === 'resuming'
  const connected = active && snapshot.phase !== 'connecting' && !suspended
  const selectedWords = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds])
  const hasSpeech = snapshot.turns.some((turn) => turn.role === 'user' && turn.final && turn.text.trim())
  const currentScenario = VOICE_SCENARIOS.find((item) => item.id === scenario) ?? VOICE_SCENARIOS[0]
  const scenarioDescription = selection.descriptions[scenario]?.trim() ?? ''
  const liveFeedbackAvailable = hasDeepseekApiKey()
  const hasTurns = snapshot.turns.length > 0
  const history = useVoiceHistory()
  const previousReplies = useMemo(() => {
    let previous = ''
    const contexts: string[] = []
    for (const turn of snapshot.turns) {
      contexts.push(previous)
      if (turn.role === 'assistant' && turn.final && !turn.interrupted && turn.text.trim()) previous = turn.text
    }
    return contexts
  }, [snapshot.turns])

  useEffect(() => () => {
    const call = sessionRef.current
    sessionRef.current = null
    call?.end()
    feedbackRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!snapshot.turns.length) return
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [snapshot.turns])

  useEffect(() => {
    if (!hasTurns) return
    const transcript = transcriptRef.current
    const content = transcriptContentRef.current
    if (!transcript || !content || typeof ResizeObserver === 'undefined') return
    let followingLatest = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 48
    const onScroll = () => { followingLatest = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 48 }
    const observer = new ResizeObserver(() => {
      if (followingLatest) transcript.scrollTop = transcript.scrollHeight
    })
    transcript.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(content)
    return () => { observer.disconnect(); transcript.removeEventListener('scroll', onScroll) }
  }, [hasTurns])

  function start() {
    if (onRequestLogin) { onRequestLogin(); return }
    if (!config?.configured || active || !audioRef.current) return
    feedbackRef.current?.abort()
    feedbackRef.current = null
    setFeedbackBusy(false)
    setFeedback(null)
    setMessage('')
    setSnapshot(EMPTY_VOICE_SNAPSHOT)
    history.begin({ mode: 'realtime', scenario, description: scenarioDescription, difficulty })
    let savedTurns = EMPTY_VOICE_SNAPSHOT.turns
    const call = new VoiceSession({
      audio: audioRef.current, scenario, scenarioDescription, difficulty, accent,
      words: selectedWords.map(({ expression, zhGloss }) => ({ expression, zhGloss })),
      onChange: (next) => {
        if (sessionRef.current !== call) return
        setSnapshot(next)
        if (next.turns.length && (next.turns !== savedTurns || ['ended', 'paused', 'error'].includes(next.phase))) {
          savedTurns = next.turns
          history.save({ turns: next.turns, elapsedSeconds: next.elapsedSeconds })
        }
      },
      onLevel: (level) => meterRef.current?.update(level),
    })
    sessionRef.current = call
    void call.start()
  }

  async function requestFeedback() {
    if (active || !hasSpeech || feedbackBusy) return
    if (!hasDeepseekApiKey()) { setMessage('请先在学习设置中配置 DeepSeek Key，再生成反馈。'); return }
    const controller = new AbortController()
    feedbackRef.current = controller
    setFeedbackBusy(true)
    setMessage('')
    try {
      const result = await generateVoiceFeedback(snapshot.turns, controller.signal)
      if (!controller.signal.aborted) { setFeedback(result); history.save({ feedback: result }) }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '反馈生成失败，请手动重试。')
    } finally { if (!controller.signal.aborted) setFeedbackBusy(false) }
  }

  function transcriptText() {
    return [
      `Lomi English · ${currentScenario.label} · ${snapshot.elapsedSeconds} 秒`,
      ...snapshot.turns.filter((turn) => turn.text).map((turn) => `${turn.role === 'user' ? '你' : 'AI'}${turn.interrupted ? '（被打断）' : !turn.final ? '（未完成）' : ''}: ${turn.text}`),
      ...(feedback ? ['', '练习反馈（基于转写）', feedback.summaryZh,
        ...feedback.corrections.map((row) => `${row.original} → ${row.improved}\n${row.explanationZh}`),
        ...feedback.expressions.map((row) => `${row.en} — ${row.zh}`)] : []),
    ].join('\n\n')
  }

  async function copy() {
    try { await navigator.clipboard.writeText(transcriptText()); setMessage('对话文字已复制。') }
    catch { setMessage('无法访问剪贴板，请下载对话文字。') }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([transcriptText()], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'recall-english-voice.txt'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="voice-page" aria-labelledby="voice-title">
    <header className="voice-heading">
      <div><p className="eyebrow">SPEAK A LITTLE, EVERY DAY</p><h1 id="voice-title">把学过的英语，说出来。</h1><p>从一个真实场景开始，随时暂停，再接着聊。</p></div>
      <div className="voice-mode-heading"><span className="voice-provider">实时畅聊 · 千问北京</span><button className="mini-text-button" disabled={active} onClick={onBack} type="button">切换模式</button></div>
    </header>
    <div className="voice-layout">
      <VoicePreparation items={items} selection={selection} onSelection={onSelection} active={active} serviceState={onRequestLogin ? '可先选择场景和难度，开始练习时再登录。' : configError || (config ? config.configured ? '千问语音已配置' : '语音服务尚未配置。请在学习设置查看配置方法。' : '正在检查语音服务…')} onReload={configError || (config && !config.configured) ? reload : undefined} />
      <div className="voice-conversation">
        <div className="voice-call-status"><span role="status"><i className={connected ? 'is-live' : ''} aria-hidden="true" />{PHASE_LABELS[snapshot.phase]}{snapshot.muted && connected ? ' · 麦克风已静音' : ''}</span><span className="voice-countdown" aria-label={`已练习 ${snapshot.elapsedSeconds} 秒`}>{Math.floor(snapshot.elapsedSeconds / 60)}:{String(snapshot.elapsedSeconds % 60).padStart(2, '0')}</span></div>
        <div className="voice-transcript" ref={transcriptRef} role="log" aria-label="对话字幕" aria-live="polite" aria-relevant="additions text">
          {snapshot.turns.length === 0 ? <div className="voice-empty"><span className="voice-mic-mark"><Icon name="mic" size={36} /></span><h2>{currentScenario.topic}</h2><p className="voice-scene-description">{scenarioDescription || '不必想好每句话。先开口，AI 会接着聊。'}</p><small>可以插话，也可以请 AI 用中文解释。</small></div> : <div ref={transcriptContentRef}>{snapshot.turns.map((turn, index) => <div className={`voice-turn voice-turn-${turn.role}`} key={turn.id}>
            <span>{turn.role === 'user' ? '你' : 'AI 陪练'}</span>
            <div className="voice-turn-content">
              <p>{turn.text || (active ? '正在识别…' : '未收到转写')}</p>
              {liveFeedbackAvailable && turn.role === 'user' && turn.final && !turn.interrupted && turn.text.trim() && <VoiceTurnFeedback key={turn.text} text={turn.text} previousReply={previousReplies[index]} onSave={onSaveExpression} onResult={(corrections) => history.corrections(turn.id, corrections)} />}
            </div>
            {turn.interrupted ? <small>被打断 · 字幕可能包含未播放内容</small> : !turn.final ? <small>{active ? '文字生成中…' : '转写未完成'}</small> : null}
          </div>)}</div>}
        </div>
        <MicrophoneIndicator ref={meterRef} enabled={connected && !snapshot.muted} label={suspended ? '对话已暂停，麦克风已关闭' : connected ? snapshot.muted ? '麦克风已静音' : '麦克风已开启，等待你说话' : active ? '连接后开启麦克风' : '麦克风已关闭'} confirmation={snapshot.phase === 'listening' ? 'AI 正在听你说' : snapshot.phase === 'thinking' ? 'AI 正在思考' : undefined} />
        {snapshot.notice && <p className="voice-notice" role={snapshot.phase === 'error' ? 'alert' : 'status'}>{snapshot.notice}</p>}
        {snapshot.needsAudio && <button className="secondary-button" onClick={() => void sessionRef.current?.enableAudio()} type="button">启用声音</button>}
        <div className="voice-call-actions">
          {active ? <>{suspended ? <button className="secondary-button" disabled={snapshot.phase === 'resuming'} onClick={() => void sessionRef.current?.resume()} type="button">{snapshot.phase === 'resuming' ? '正在继续…' : '继续对话'}</button> : <button className="secondary-button" disabled={!connected} onClick={() => sessionRef.current?.pause()} type="button">暂停对话</button>}<button className="secondary-button" disabled={!connected} onClick={() => sessionRef.current?.setMuted(!snapshot.muted)} type="button"><Icon name="mic" size={18} />{snapshot.muted ? '取消静音' : '静音麦克风'}</button><button className="primary-button voice-end" onClick={() => sessionRef.current?.end()} type="button">{snapshot.phase === 'connecting' ? '取消连接' : '结束对话'}</button></> : <button className="primary-button" disabled={(!onRequestLogin && !config?.configured) || feedbackBusy} onClick={start} type="button"><Icon name="mic" size={19} />{snapshot.phase === 'idle' ? '开始对话' : '重新开始对话'}</button>}
        </div>
        <div className="voice-help-actions" aria-label="对话辅助">
          <button className="mini-text-button" disabled={!connected || snapshot.phase !== 'ready'} onClick={() => sessionRef.current?.requestHelp('slower')} type="button">说慢一点</button>
          <button className="mini-text-button" disabled={!connected || snapshot.phase !== 'ready'} onClick={() => sessionRef.current?.requestHelp('chinese')} type="button">中文解释</button>
          <button className="mini-text-button" disabled={!connected || snapshot.phase !== 'ready'} onClick={() => sessionRef.current?.requestHelp('hint')} type="button">给点提示</button>
        </div>
        <p className="voice-footnote">暂停时关闭麦克风并停止播放，保留当前对话；继续后由你接着说。口语对话本身不计为词汇掌握。确认并加入复习的表达，会按每日新词数量安排。字幕可能存在偏差。</p>
        <p className="voice-footnote">字幕和反馈自动保存在本机，登录账号时会同步云端，可从「练习历史」回看或删除；实时畅聊不保存录音。</p>
        {history.status && <p className="voice-notice" role="status">{history.status}{history.status.includes('失败') && <button type="button" className="mini-text-button" onClick={history.retry}>重试保存</button>}</p>}
        <p className="voice-footnote">{liveFeedbackAvailable ? '实时纠错已开启：每句转写完成后自动发送本句和上一条完整 AI 发言给 DeepSeek，结果显示在原句旁。仅检查文字表达，可能稍有延迟；不上传录音。' : '在学习设置中配置 DeepSeek 后可自动逐句纠错；语音对话可照常进行。'}</p>
      </div>
    </div>
    {snapshot.turns.some((turn) => turn.text) && <section className="voice-review" aria-labelledby="voice-review-title">
      <div className="voice-review-heading"><div><p className="eyebrow">02 / 回看这次表达</p><h2 id="voice-review-title">聊完，再打磨。</h2></div><div className="voice-export-actions"><button className="secondary-button" onClick={() => void copy()} type="button">复制文字</button><button className="secondary-button" onClick={download} type="button"><Icon name="download" size={17} />下载文字</button></div></div>
      <p>点击后将已完成的个人发言转写发送给 DeepSeek，生成表达建议。最多 30,000 字符，超出时仅发送此前完整发言。反馈不评估发音，不作为掌握证据。</p>
      <button className="primary-button" disabled={active || feedbackBusy || !hasSpeech || Boolean(feedback)} onClick={() => void requestFeedback()} type="button">{feedbackBusy ? '正在生成反馈…' : feedback ? '本次反馈已生成' : '生成本次练习反馈'}</button>
      {feedback && <VoiceFeedbackReview feedback={feedback} onSave={onSaveExpression} />}
      <p className="voice-footnote">已收到用量：输入 {snapshot.usage.inputTokens} / 输出 {snapshot.usage.outputTokens} tokens。{snapshot.usage.complete ? `语音模型估算 ¥${snapshot.usage.estimatedYuan.toFixed(4)}（按 2026-10-07 北京价格）` : '费用未完整统计'}；不含输入转写、DeepSeek 及尚未返回的用量，以控制台账单为准。</p>
    </section>}
    {message && <p className="voice-notice" role="status">{message}</p>}
    <audio ref={audioRef} autoPlay />
  </section>
}

export function VoicePractice({ items, accent, onRequestLogin, onSaveExpression, learningGoal }: { items: VocabularyItem[]; accent: SpeechAccent; onRequestLogin?: () => void; onSaveExpression?: SaveVoiceExpression; learningGoal?: SystemListSlug }) {
  const [mode, setMode] = useState<'realtime' | 'messages' | null>(null)
  const [selection, setSelection] = useState(() => ({ ...DEFAULT_VOICE_SELECTION, scenario: learningGoal === 'accounting' ? 'finance' as const : learningGoal ?? DEFAULT_VOICE_SELECTION.scenario }))
  const shared = { items, accent, selection, onSelection: setSelection, onBack: () => setMode(null), onRequestLogin, onSaveExpression }
  if (mode === 'realtime') return <RealtimeVoicePractice {...shared} />
  if (mode === 'messages') return <VoiceMessages {...shared} />
  return <section className="voice-page" aria-labelledby="voice-title">
    <header className="voice-heading"><div><p className="eyebrow">SPEAK A LITTLE, EVERY DAY</p><h1 id="voice-title">把学过的英语，说出来。</h1><p>今天想怎么练？选择一种方式，从真实场景开始。</p></div><span className="voice-provider">千问语音 · 北京</span></header>
    <div className="voice-mode-cards">
      <button className="voice-mode-card" onClick={() => setMode('realtime')} type="button"><span className="voice-mode-number">01 / LIVE</span><span className="voice-mode-icon"><Icon name="mic" size={32} /></span><strong>实时畅聊</strong><span>边说边回应，自然接话，也可以插话。</span><small>练习反应速度与连续表达 <span aria-hidden="true">↗</span></small></button>
      <button className="voice-mode-card voice-mode-message" onClick={() => setMode('messages')} type="button"><span className="voice-mode-number">02 / MESSAGES</span><span className="voice-mode-icon" aria-hidden="true">▤</span><strong>语音消息</strong><span>录好一条再发送，AI 也用语音回复。</span><small>慢慢组织表达，每条都能回听 <span aria-hidden="true">↗</span></small></button>
    </div>
    <p className="voice-mode-note">两种方式共用场景、难度和词汇设置，应用不限制练习时长。实时畅聊可随时暂停，结束后可生成表达反馈。百炼单次连接最长 120 分钟。</p>
    {!onRequestLogin && <VoiceHistory onSaveExpression={onSaveExpression} />}
  </section>
}
