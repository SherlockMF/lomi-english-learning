import { useEffect, useEffectEvent, useState } from 'react'
import { generateVoiceTurnFeedback, type VoiceFeedback } from '../lib/voice/feedback'
import type { SaveVoiceExpression as SaveAction } from '../lib/voice/review'
import { SaveVoiceExpression } from './SaveVoiceExpression'

type Result = { attempt: number } & ({ corrections: VoiceFeedback['corrections']; failed?: false } | { failed: true })

export function VoiceTurnFeedback({ text, previousReply, onSave, onResult }: { text: string; previousReply: string; onSave?: SaveAction; onResult?: (corrections: VoiceFeedback['corrections']) => void }) {
  const reportResult = useEffectEvent((corrections: VoiceFeedback['corrections']) => onResult?.(corrections))
  // Freeze context when this finalized utterance appears; later AI subtitles must not recheck it.
  const [context] = useState(previousReply)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const current = result?.attempt === attempt ? result : null

  useEffect(() => {
    const controller = new AbortController()
    async function check() {
      // Let StrictMode's setup/cleanup finish before making a billable request.
      await Promise.resolve()
      if (controller.signal.aborted) return
      try {
        const corrections = await generateVoiceTurnFeedback(text, context, controller.signal)
        if (!controller.signal.aborted) { setResult({ attempt, corrections }); reportResult(corrections) }
      } catch {
        if (!controller.signal.aborted) setResult({ attempt, failed: true })
      }
    }
    void check()
    return () => controller.abort()
  }, [text, context, attempt])

  return <div className={`voice-turn-feedback${current && !current.failed && current.corrections.length ? ' has-corrections' : ''}`} role="status" aria-label="本句表达反馈">
    {!current ? <span>正在检查表达…</span> : current.failed ? <>
      <span>本句检查失败</span>
      <button className="mini-text-button" type="button" onClick={() => setAttempt((value) => value + 1)}>重试本句纠错</button>
    </> : current.corrections.length ? current.corrections.map((correction) => <div className="voice-turn-correction" key={`${correction.original}:${correction.improved}`}>
      <span className="voice-correction-label">建议改为</span>
      <p lang="en"><strong>{correction.improved}</strong></p>
      <small>{correction.explanationZh}</small>
      <SaveVoiceExpression onSave={onSave} draft={{ expression: correction.improved, meaning: '', original: correction.original, note: correction.explanationZh }} />
    </div>) : <span>未发现明显语法或用词问题</span>}
  </div>
}
