import { useEffect, useRef, useState } from 'react'
import type { VoiceTurn } from '../lib/voice/transcript'

export interface VoiceMessage extends VoiceTurn {
  audioBlob?: Blob
  audioUrl: string
  duration: number
  status: 'sending' | 'sent' | 'failed'
  pcm?: Uint8Array<ArrayBuffer>
}

export function VoiceMessageBubble({ message, autoPlay, disabled, onPlay, onError, onRetry }: { message: VoiceMessage; autoPlay?: boolean; disabled?: boolean; onPlay: (audio: HTMLAudioElement) => void; onError: () => void; onRetry?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const duration = Math.max(1, Math.round(message.duration))
  const play = async () => {
    const element = audio.current
    if (!element) return
    onPlay(element)
    try { await element.play() } catch { setPlaying(false); onError() }
  }
  useEffect(() => {
    const element = audio.current
    let active = true
    if (element) element.src = message.audioUrl
    if (autoPlay && element) { onPlay(element); void element.play().catch(() => { if (active) { setPlaying(false); onError() } }) }
    return () => { active = false; if (element) { element.pause(); element.removeAttribute('src'); element.load() } }
    // Each new assistant audio is autoplayed once; subsequent renders keep playback unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.audioUrl])
  return <div className={`voice-turn voice-turn-${message.role} voice-message-bubble`}>
    <span>{message.role === 'user' ? '你' : 'AI 陪练'}</span>
    <button disabled={disabled} className={`voice-audio-button ${playing ? 'is-playing' : ''}`} type="button" aria-label={`${playing ? '暂停' : '播放'}${message.role === 'user' ? '你的' : 'AI 的'} ${duration} 秒语音`} onClick={() => { if (playing) audio.current?.pause(); else void play() }}>
      <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span><span className="voice-audio-wave" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6].map((index) => <i key={index} />)}</span><strong>{duration}″</strong>
    </button>
    <audio ref={audio} src={message.audioUrl} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    {message.status === 'sending' && <small role="status">已录入 · 正在发送并等待 AI 回复…</small>}
    {message.status === 'failed' && <div className="voice-message-failed"><small>发送失败 · 录音已保留，可回听</small>{onRetry && <button type="button" className="mini-text-button" onClick={onRetry}>重试发送</button>}</div>}
    {message.text ? <details className="voice-message-text"><summary>查看文字</summary><p>{message.text}</p></details> : message.status === 'sent' && message.role === 'user' ? <small>未收到文字转写，反馈不会包含这条发言。</small> : null}
  </div>
}
