import { useEffect, useRef, useState } from 'react'
import { VOCABULARY_LEVELS, type SpeechAccent, type SystemListSlug, type UserSettings, type VocabularyLevel } from '../domain/types'
import { onboardingSettings } from '../lib/onboarding'
import { vocabularyLevelLabels } from '../lib/studyDifficulty'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { StudyCategoryPicker } from './StudyCategoryPicker'

export function OnboardingDialog({ settings, onComplete, onClose, hasLearningHistory = false, embedded = false }: {
  settings: UserSettings; onComplete: (settings: UserSettings, start: boolean) => Promise<void>; onClose: () => void
  hasLearningHistory?: boolean; embedded?: boolean
}) {
  const [level, setLevel] = useState<VocabularyLevel>(settings.vocabularyLevel ?? 'B1')
  const [count, setCount] = useState([3, 5, 10].includes(settings.newItemsPerDay) ? settings.newItemsPerDay : 5)
  const [accent, setAccent] = useState<SpeechAccent>(settings.speechAccent)
  const [categories, setCategories] = useState<SystemListSlug[]>(() =>
    settings.onboardingCompletedAt || settings.learningGoal || hasLearningHistory ? [...settings.activeCategories] : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLElement>(null)
  useFocusTrap(ref)
  useEscapeToClose(() => { if (!embedded && !busy) onClose() })
  useEffect(() => {
    if (embedded) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow }
  }, [embedded])
  async function save(start: boolean) {
    if (!categories.length || busy) return
    setBusy(true); setError('')
    try { await onComplete(onboardingSettings(settings, { level, count, accent, categories }), start) }
    catch { setError('设置未保存成功，请重试。') }
    finally { setBusy(false) }
  }
  const content = <>
    <h2 id="onboarding-title">选择你的学习词库</h2>
    <p>{hasLearningHistory ? '保存后按新的词库优先级安排新词。' : '选好方向，先学最多 3 个表达。以后可以到「词库」调整。'}</p>
    <fieldset disabled={busy}>
      <StudyCategoryPicker categories={categories} onChange={setCategories} />
      <details className="onboarding-advanced" open={!embedded || undefined}>
        <summary>难度、每日新词和口音</summary>
        <label className="text-setting"><span>从哪个难度开始</span><select value={level} onChange={event => setLevel(event.target.value as VocabularyLevel)}>{VOCABULARY_LEVELS.map(value => <option key={value} value={value}>{vocabularyLevelLabels[value]}</option>)}</select></label>
        <p className="form-note">拿不准可从 A2 开始，难度会按学习表现调整。</p>
        <label className="text-setting"><span>每天认识几个新表达</span><select value={count} onChange={event => setCount(Number(event.target.value))}><option value={3}>3 个 · 轻松起步</option><option value={5}>5 个 · 稳定积累</option><option value={10}>10 个 · 多练一点</option></select></label>
        <label className="text-setting"><span>喜欢的口音</span><select value={accent} onChange={event => setAccent(event.target.value as SpeechAccent)}><option value="uk">UK 英式</option><option value="us">US 美式</option></select></label>
      </details>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions">
      <button className="mini-text-button" type="button" disabled={busy} onClick={onClose}>暂时关闭</button>
      <button className="secondary-button" type="button" disabled={busy || !categories.length} onClick={() => void save(false)}>保存，先逛逛</button>
      <button className="primary-button" type="button" disabled={busy || !categories.length} onClick={() => void save(true)}>{busy ? '正在准备…' : hasLearningHistory ? '保存并开始学习' : '开始第一课'}</button>
    </div>
  </>
  return embedded
    ? <section className="panel onboarding-setup" aria-labelledby="onboarding-title">{content}</section>
    : <div className="dialog-backdrop"><section ref={ref} className="dialog-card onboarding-dialog onboarding-setup" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">{content}</section></div>
}
