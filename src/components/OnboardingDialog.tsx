import { useEffect, useRef, useState } from 'react'
import { DEFAULT_ACTIVE_CATEGORIES, VOCABULARY_LEVELS, type SpeechAccent, type SystemListSlug, type UserSettings, type VocabularyLevel } from '../domain/types'
import { LEARNING_GOALS, ONBOARDING_CATEGORY_ORDER, onboardingSettings } from '../lib/onboarding'
import { vocabularyLevelLabels } from '../lib/studyDifficulty'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useEscapeToClose } from '../lib/useEscapeToClose'

export function OnboardingDialog({ settings, onComplete, onClose, hasLearningHistory = false }: {
  settings: UserSettings; onComplete: (settings: UserSettings, start: boolean) => Promise<void>; onClose: () => void; hasLearningHistory?: boolean
}) {
  const [goal, setGoal] = useState<SystemListSlug>(settings.learningGoal ?? 'daily')
  const [level, setLevel] = useState<VocabularyLevel>(settings.vocabularyLevel ?? 'B1')
  const [count, setCount] = useState([3, 5, 10].includes(settings.newItemsPerDay) ? settings.newItemsPerDay : 5)
  const [accent, setAccent] = useState<SpeechAccent>(settings.speechAccent)
  const [categories, setCategories] = useState<SystemListSlug[]>(
    settings.activeCategories?.length ? [...settings.activeCategories] : [...DEFAULT_ACTIVE_CATEGORIES],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLElement>(null)
  useFocusTrap(ref)
  useEscapeToClose(() => { if (!busy) onClose() })
  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow }
  }, [])
  function toggleCategory(slug: SystemListSlug) {
    setCategories((current) => current.includes(slug)
      ? current.filter((entry) => entry !== slug)
      : [...current, slug])
  }
  async function save(start: boolean) {
    setBusy(true); setError('')
    try { await onComplete(onboardingSettings(settings, { goal, level, count, accent, categories }), start) }
    catch { setError('设置未保存成功，请重试。') }
    finally { setBusy(false) }
  }
  return <div className="dialog-backdrop"><section ref={ref} className="dialog-card onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <p className="eyebrow">YOUR FIRST STEP</p><h2 id="onboarding-title">从你用得上的英语开始</h2>
    <p>{hasLearningHistory ? '调整接下来的学习节奏，保留已有记录。保存后可继续今天的计划。' : '先练最多 3 个表达，体验「看意思 → 自己想 → 再复习」。以后可以随时在设置里调整。'}</p>
    <fieldset disabled={busy}>
      <div className="text-setting">
        <span>想学哪些场景（可多选）</span>
        <div className="filter-pills" role="group" aria-label="学习场景多选">
          {ONBOARDING_CATEGORY_ORDER.map((slug) => (
            <button key={slug} type="button" className={categories.includes(slug) ? 'active' : ''} aria-pressed={categories.includes(slug)} onClick={() => toggleCategory(slug)}>{LEARNING_GOALS[slug]}</button>
          ))}
        </div>
      </div>
      <p className="form-note">普通新词只从勾选的场景里安排；至少保留一类。主场景决定第一课的选词。</p>
      <label className="text-setting"><span>最想用英语做什么</span><select value={goal} onChange={event => setGoal(event.target.value as SystemListSlug)}>{Object.entries(LEARNING_GOALS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-setting"><span>从哪个难度开始</span><select value={level} onChange={event => setLevel(event.target.value as VocabularyLevel)}>{VOCABULARY_LEVELS.map(value => <option key={value} value={value}>{vocabularyLevelLabels[value]}</option>)}</select></label>
      <p className="form-note">这不是水平测试。拿不准可从 A2 开始，难度会按学习表现调整。</p>
      <label className="text-setting"><span>每天认识几个新表达</span><select value={count} onChange={event => setCount(Number(event.target.value))}><option value={3}>3 个 · 轻松起步</option><option value={5}>5 个 · 稳定积累</option><option value={10}>10 个 · 多练一点</option></select></label>
      <label className="text-setting"><span>喜欢的口音</span><select value={accent} onChange={event => setAccent(event.target.value as SpeechAccent)}><option value="uk">UK 英式</option><option value="us">US 美式</option></select></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button className="mini-text-button" type="button" disabled={busy} onClick={onClose}>暂时关闭</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void save(false)}>保存，先逛逛</button><button className="primary-button" type="button" disabled={busy} onClick={() => void save(true)}>{busy ? '正在准备…' : hasLearningHistory ? '保存并开始学习' : '开始第一课'}</button></div>
  </section></div>
}
