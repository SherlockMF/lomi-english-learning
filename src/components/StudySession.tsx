import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  HintLevel,
  LearningTrack,
  ReviewRating,
  SessionSummary,
  SessionTask,
  SpeechAccent,
  StudyTimeEntry,
  VocabularyItem,
  VocabularyLevel,
} from '../domain/types'
import type { GradeMatchKind } from '../lib/grading'
import type { LearningStats } from '../lib/learningStats'
import { categoryLabels, expressionHint, recallContext, trackLabels } from '../lib/presentation'
import { speakWord } from '../lib/speech'
import { escapeRegExp } from '../lib/text'
import { localStudyDate } from '../lib/studyTime'
import { useStudyTimer, type StudyTimerApi } from '../lib/useStudyTimer'
import { Icon } from './Icon'
import { getVocabularyDifficulty } from '../lib/studyDifficulty'

export interface EvaluationResult {
  rating: ReviewRating
  matched: boolean
  message?: string
  feedbackZh?: string
  source?: 'rules' | 'llm' | 'reveal'
  correctness?: 'correct' | 'incorrect' | 'unverified'
  matchKind?: GradeMatchKind
}

export interface RateDetail {
  answer: string
  hintLevel: HintLevel
  responseMs: number
  promptType: string
  wasOverride: boolean
  attemptId: string
  reviewedAt: string
  evidenceVersion: 1
  sessionId: string
  retryCount: number
  promptId?: string
  evaluationSource: 'rules' | 'llm' | 'reveal'
  correctness: 'correct' | 'incorrect' | 'unverified'
  matchKind: GradeMatchKind
  suggestedRating: ReviewRating
}

interface FailedSave {
  key: string
  label: string
  task: SessionTask
  rating: ReviewRating
  detail: RateDetail
  message: string
}

interface StudySessionProps {
  mode: 'core' | 'extension'
  initialTasks: SessionTask[]
  items: VocabularyItem[]
  tracks: LearningTrack[]
  usableThisWeek: number
  learningStats?: LearningStats
  sessionId?: string
  timeEntries?: StudyTimeEntry[]
  onSaveTime?: (entry: StudyTimeEntry) => Promise<void>
  onDayChange?: () => boolean | void | Promise<boolean | void>
  canVerifySentence?: boolean
  speechAccent?: SpeechAccent
  onSpeechAccentChange?: (accent: SpeechAccent) => void
  evaluate: (
    task: SessionTask,
    item: VocabularyItem,
    answer: string,
    hintLevel: HintLevel,
    revealed: boolean,
    responseMs: number,
    options?: {
      onInterim?: (result: EvaluationResult) => void
      verifySentence?: boolean
    },
  ) => EvaluationResult | Promise<EvaluationResult>
  resolveHint?: (task: SessionTask, item: VocabularyItem, hintLevel: HintLevel) => Promise<string>
  ensureUsageItem?: (item: VocabularyItem) => Promise<VocabularyItem>
  onRate: (task: SessionTask, rating: ReviewRating, detail: RateDetail) => Promise<void>
  onMarkKnown?: (item: VocabularyItem) => Promise<void>
  onRefreshTasks?: (pending: SessionTask[], started: ReadonlySet<string>, force: boolean) => Promise<SessionTask[]>
  difficultyLevel?: VocabularyLevel
  onExit: () => void
  onFinish: (summary: SessionSummary) => void
  dailyPlanComplete?: boolean
  onStartExtra?: () => void
}

type Submission = Pick<RateDetail, 'answer' | 'hintLevel' | 'responseMs' | 'reviewedAt' | 'attemptId' | 'promptId' | 'promptType'>

export function StudySession({
  mode, initialTasks, items, tracks, usableThisWeek, learningStats,
  sessionId: suppliedSessionId,
  timeEntries, onSaveTime, onDayChange, canVerifySentence = false,
  speechAccent = 'uk', onSpeechAccentChange, evaluate, resolveHint, ensureUsageItem,
  onRate, onExit, onFinish, onMarkKnown, onRefreshTasks, difficultyLevel, dailyPlanComplete, onStartExtra,
}: StudySessionProps) {
  const sessionId = useRef(suppliedSessionId ?? crypto.randomUUID()).current
  const sessionDay = useRef(localStudyDate()).current
  const [tasks, setTasks] = useState(initialTasks)
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [hintLevel, setHintLevel] = useState<HintLevel>(0)
  const [hintText, setHintText] = useState('')
  const [phase, setPhase] = useState<'question' | 'feedback' | 'complete'>(
    initialTasks.length ? 'question' : 'complete',
  )
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [correction, setCorrection] = useState('')
  const [failedSaves, setFailedSaves] = useState<FailedSave[]>([])
  const [flushingExit, setFlushingExit] = useState(false)
  const [grading, setGrading] = useState(false)
  const [hinting, setHinting] = useState(false)
  const [ensuringUsage, setEnsuringUsage] = useState(false)
  const [usageEnsureError, setUsageEnsureError] = useState<string | null>(null)
  const [accent, setAccent] = useState<SpeechAccent>(speechAccent)
  const [itemOverrides, setItemOverrides] = useState<Record<string, VocabularyItem>>({})
  const [summary, setSummary] = useState<SessionSummary>({ total: 0, noHintGood: 0, again: 0, usageCompleted: 0, usableThisWeek })
  const [failedWords, setFailedWords] = useState<string[]>([])
  const [pendingWrites, setPendingWrites] = useState(0)
  const [paused, setPaused] = useState(false)
  const [verificationRequested, setVerificationRequested] = useState(false)
  const [rebuildMode, setRebuildMode] = useState<'day' | null>(null)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [queueRetry, setQueueRetry] = useState<{ tasks: SessionTask[]; force: boolean; message: string } | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const finishCalled = useRef(false)
  const submittedTaskIds = useRef(new Set<string>())
  const savedItemIds = useRef(new Set<string>())
  const savedQuestionIds = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const requestId = useRef(0)
  const submission = useRef<Submission | null>(null)
  const questionStartedMs = useRef(0)
  const failedSavesRef = useRef<FailedSave[]>([])
  const savingRef = useRef(false)
  const verificationRef = useRef(false)
  const timer = useStudyTimer({
    sessionId, entries: timeEntries, save: onSaveTime,
    enabled: (phase === 'question' || phase === 'feedback') && !grading && !hinting && !ensuringUsage
      && !paused && !flushingExit && !queueRetry && rebuildMode !== 'day' && pendingWrites === 0 && failedSaves.length === 0,
  })

  useEffect(() => {
    mountedRef.current = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      mountedRef.current = false
      requestId.current += 1
      document.body.style.overflow = previousOverflow
    }
  }, [])
  useEffect(() => { setAccent(speechAccent) }, [speechAccent])

  function updateFailedSaves(next: FailedSave[]) {
    failedSavesRef.current = next
    if (mountedRef.current) setFailedSaves(next)
  }
  function chooseAccent(next: SpeechAccent) { setAccent(next); onSpeechAccentChange?.(next) }
  function isCurrent(id: number) { return mountedRef.current && requestId.current === id }

  async function completeSession() {
    timer.setRunning(false)
    if (await timer.flush()) setPhase('complete')
  }

  async function afterSaved(entry: FailedSave) {
    if (submittedTaskIds.current.has(entry.task.id)) return
    submittedTaskIds.current.add(entry.task.id)
    savedItemIds.current.add(entry.task.itemId)
    if ((entry.task.retryCount ?? 0) === 0) savedQuestionIds.current.add(entry.task.id)
    setSummary((current) => ({
      ...current,
      total: current.total + 1,
      noHintGood: current.noHintGood + (entry.detail.correctness === 'correct' && entry.detail.hintLevel === 0 && !entry.detail.wasOverride ? 1 : 0),
      again: current.again + (entry.rating === 'again' ? 1 : 0),
      usageCompleted: current.usageCompleted + (entry.task.trackType === 'usage' && entry.detail.correctness === 'correct' && !entry.detail.wasOverride ? 1 : 0),
    }))
    if (entry.rating === 'again') setFailedWords((words) => words.includes(entry.label) ? words : [...words, entry.label])
    if (localStudyDate() !== sessionDay && onDayChange) { await rebuildSession('day'); return }
    let nextTasks = tasks
    if (entry.rating === 'again' && (entry.task.retryCount ?? 0) < 2) {
      const retry = { ...entry.task, id: `${entry.task.id}-retry-${(entry.task.retryCount ?? 0) + 1}`, isNew: false, retryCount: (entry.task.retryCount ?? 0) + 1 }
      nextTasks = [...tasks]
      let retryIndex = Math.min(nextTasks.length, index + 4)
      if (items.find((vocabularyItem) => vocabularyItem.id === entry.task.itemId)?.listSlugs.includes('my-vocabulary')) {
        const ordinaryStart = nextTasks.findIndex((candidate, candidateIndex) => candidateIndex > index
          && candidate.isNew && !items.find((vocabularyItem) => vocabularyItem.id === candidate.itemId)?.listSlugs.includes('my-vocabulary'))
        if (ordinaryStart >= 0) retryIndex = Math.min(retryIndex, ordinaryStart)
      }
      nextTasks.splice(retryIndex, 0, retry)
      setTasks(nextTasks)
    }
    await advanceQueue(nextTasks, false)
  }

  async function advanceQueue(nextTasks: SessionTask[], force: boolean) {
    if (onRefreshTasks) {
      try {
        const pending = await onRefreshTasks(nextTasks.slice(index + 1), savedItemIds.current, force)
        nextTasks = [...nextTasks.slice(0, index + 1), ...pending]
      } catch (error) {
        setQueueRetry({ tasks: nextTasks, force, message: error instanceof Error ? error.message : '调整下一组词汇失败，请重试。' })
        return
      }
    }
    setQueueRetry(null)
    setTasks(nextTasks)
    if (index + 1 >= nextTasks.length) { await completeSession(); return }
    setIndex((value) => value + 1)
    setAnswer(''); setCorrection(''); setHintLevel(0); setHintText('')
    setRevealed(false); setEvaluation(null); setVerificationRequested(false)
    verificationRef.current = false
    submission.current = null
    questionStartedMs.current = timer.sample()
    setPhase('question')
  }

  async function markKnown(currentTask: SessionTask) {
    const current = items.find((word) => word.id === currentTask.itemId)
    if (!current || !onMarkKnown || savingRef.current) return
    savingRef.current = true
    setPendingWrites(1)
    timer.setRunning(false)
    setRebuildError(null)
    try {
      if (!(await timer.flush())) return
      await onMarkKnown(current)
      const remaining = tasks.filter((candidate, candidateIndex) => candidateIndex <= index || candidate.itemId !== current.id)
      await advanceQueue(remaining, true)
    } catch (error) {
      setRebuildError(error instanceof Error ? error.message : '保存已会标记失败，请重试。')
    } finally {
      savingRef.current = false
      if (mountedRef.current) setPendingWrites(0)
    }
  }

  async function retryQueue() {
    if (!queueRetry || savingRef.current) return
    savingRef.current = true; setPendingWrites(1)
    try { await advanceQueue(queueRetry.tasks, queueRetry.force) }
    finally { savingRef.current = false; setPendingWrites(0) }
  }

  async function persistRating(entry: FailedSave) {
    if (savingRef.current) return
    savingRef.current = true
    setPendingWrites(1)
    timer.setRunning(false)
    try {
      await onRate(entry.task, entry.rating, entry.detail)
      if (!(await timer.flush())) throw new Error('作答已保存；请重试保存学习时间后继续。')
      updateFailedSaves([])
      await afterSaved(entry)
    } catch (error) {
      updateFailedSaves([{ ...entry, message: error instanceof Error ? error.message : '保存复习结果失败，请重试' }])
    } finally {
      savingRef.current = false
      if (mountedRef.current) setPendingWrites(0)
    }
  }
  async function retryFailedSaves() {
    const entry = failedSavesRef.current[0]
    if (entry) await persistRating(entry)
  }
  async function requestExit(onSaved = onExit) {
    if (flushingExit || savingRef.current || failedSavesRef.current.length) return
    requestId.current += 1
    setGrading(false)
    setHinting(false)
    setFlushingExit(true)
    timer.setRunning(false)
    try { if (await timer.flush()) onSaved() }
    finally { if (mountedRef.current) setFlushingExit(false) }
  }
  async function rebuildSession(kind: 'day') {
    if (flushingExit) return
    setFlushingExit(true)
    setRebuildMode(kind)
    setRebuildError(null)
    timer.setRunning(false)
    try {
      if (!(await timer.flush())) return
      const result = await onDayChange?.()
      if (result === false) throw new Error('重新安排学习失败，请重试。')
    } catch (error) {
      if (mountedRef.current) setRebuildError(error instanceof Error ? error.message : '重新安排学习失败，请重试。')
    } finally {
      if (mountedRef.current) setFlushingExit(false)
    }
  }

  const task = tasks[index]
  const item = useMemo(() => task ? itemOverrides[task.itemId] ?? items.find((candidate) => candidate.id === task.itemId) : undefined, [itemOverrides, items, task])
  const track = useMemo(() => tracks.find((candidate) => candidate.id === task?.trackId), [tracks, task?.trackId])
  const usagePrompt = item?.usagePrompts[task?.promptIndex ?? 0]
  const isSentence = task?.trackType === 'usage' && usagePrompt?.type === 'sentence'
  const needsCorrection = phase === 'feedback' && evaluation?.rating === 'again' && !isSentence && task?.trackType !== 'receptive'
  const correctionTarget = task?.trackType === 'usage' && usagePrompt?.answer ? usagePrompt.answer : item?.expression ?? ''
  const correctionComplete = !needsCorrection || answerMatches(correction, correctionTarget, item?.acceptedEnVariants ?? [])

  useEffect(() => {
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(focusTimer)
  }, [index])
  useEffect(() => {
    if (phase === 'complete' && !finishCalled.current && !savingRef.current && failedSaves.length === 0) {
      finishCalled.current = true
      onFinish({ ...summary, usableThisWeek })
    }
  }, [onFinish, phase, summary, usableThisWeek, pendingWrites, failedSaves.length])

  useEffect(() => {
    if (!task || !item || task.trackType !== 'usage' || !ensureUsageItem || item.usagePrompts.length > 0) return
    let cancelled = false
    timer.setRunning(false)
    setEnsuringUsage(true); setUsageEnsureError(null)
    void ensureUsageItem(item).then((updated) => {
      if (!cancelled) setItemOverrides((current) => ({ ...current, [updated.id]: updated }))
      return updated
    }).catch((error) => {
      if (!cancelled) setUsageEnsureError(error instanceof Error ? error.message : '使用题生成失败，请稍后重试。')
    }).finally(() => { if (!cancelled) setEnsuringUsage(false) })
    return () => { cancelled = true; setEnsuringUsage(false) }
  }, [ensureUsageItem, item, task])

  function freezeSubmission(reveal: boolean): Submission {
    const frozen = {
      answer: reveal ? '' : answer,
      hintLevel,
      responseMs: Math.max(0, Math.round(timer.sample() - questionStartedMs.current)),
      reviewedAt: new Date().toISOString(),
      attemptId: crypto.randomUUID(),
      promptId: task.trackType === 'usage' ? usagePrompt?.id : undefined,
      promptType: task.trackType === 'usage' ? usagePrompt?.type ?? 'usage' : task.trackType,
    }
    submission.current = frozen
    return frozen
  }

  async function runEvaluation(reveal: boolean, verifySentence = false) {
    if (!task || !item || grading || hinting || ensuringUsage || savingRef.current || paused || timer.error) return
    if (task.trackType === 'usage' && item.usagePrompts.length === 0) return
    const frozen = verifySentence ? submission.current : freezeSubmission(reveal)
    if (!frozen) return
    if (verifySentence) {
      if (verificationRef.current) return
      verificationRef.current = true
      setVerificationRequested(true)
    }
    const id = ++requestId.current
    setGrading(true)
    timer.setRunning(false)
    let showedInterim = false
    try {
      const result = await evaluate(task, item, frozen.answer, frozen.hintLevel, reveal, frozen.responseMs, {
        verifySentence,
        onInterim: verifySentence ? undefined : (interim) => {
          if (!isCurrent(id)) return
          showedInterim = true
          setEvaluation(interim); setPhase('feedback'); setGrading(false)
          void speakWord(item, accent)
        },
      })
      if (!isCurrent(id)) return
      setHintLevel(reveal ? 3 : frozen.hintLevel)
      setRevealed(reveal)
      setEvaluation(reveal ? { ...result, rating: 'again', matched: false, source: 'reveal', correctness: 'incorrect', matchKind: 'incorrect' } : result)
      setPhase('feedback')
      if (!showedInterim && !verifySentence) void speakWord(item, accent)
    } catch {
      if (isCurrent(id)) {
        setEvaluation({ rating: 'again', matched: false, source: 'rules', correctness: 'unverified', matchKind: 'incorrect', feedbackZh: '当前无法验证，已保留本次回答。' })
        setPhase('feedback')
      }
    } finally { if (isCurrent(id)) setGrading(false) }
  }
  async function showForgottenAnswer() { await runEvaluation(true) }
  async function submitAnswer() { if (answer.trim() && phase === 'question') await runEvaluation(false) }

  async function requestHint() {
    if (!task || !item || hintLevel >= 2 || hinting || grading || paused) return
    const id = ++requestId.current
    const nextLevel = Math.min(2, hintLevel + 1) as HintLevel
    setHinting(true)
    timer.setRunning(false)
    let text = buildHint(task, item, nextLevel, usagePrompt)
    if (resolveHint) { try { text = await resolveHint(task, item, nextLevel) } catch { /* Local hint remains available. */ } }
    if (isCurrent(id)) { setHintLevel(nextLevel); setHintText(text); setHinting(false) }
  }

  async function chooseRating(selected: ReviewRating) {
    if (!task || !item || !evaluation || !submission.current || !correctionComplete || savingRef.current || failedSaves.length || grading || timer.error || paused) return
    if (submittedTaskIds.current.has(task.id)) return
    requestId.current += 1
    let rating = selected
    if (revealed) rating = 'again'
    else if ((hintLevel > 0 || needsCorrection) && rating === 'good') rating = 'hard'
    const detail: RateDetail = {
      ...submission.current,
      wasOverride: rating !== evaluation.rating,
      evidenceVersion: 1,
      sessionId,
      retryCount: task.retryCount ?? 0,
      evaluationSource: evaluation.source ?? 'rules',
      correctness: evaluation.correctness ?? 'unverified',
      matchKind: evaluation.matchKind ?? 'incorrect',
      suggestedRating: evaluation.rating,
    }
    await persistRating({ key: detail.attemptId, label: item.expression, task, rating, detail, message: '' })
  }

  if (rebuildMode === 'day') {
    return (
      <div className="study-overlay complete-overlay"><div className="completion-card">
        <h1>已进入新的一天</h1>
        <p>当前题已保存，将按今天的复习任务与新词额度重新安排学习。</p>
        {rebuildError && <p role="alert">{rebuildError}</p>}
        {timer.error && <p role="alert">学习时间未保存：{timer.error}</p>}
        <button className="primary-button" disabled={flushingExit} onClick={() => void rebuildSession('day')} type="button">{flushingExit ? '正在安排…' : '重新安排今日学习'}</button>
        <button aria-label="退出训练" className="secondary-button" disabled={flushingExit} onClick={() => void requestExit()} type="button">回到今天</button>
      </div></div>
    )
  }
  if (phase === 'complete') {
    const completedToday = dailyPlanComplete && failedSaves.length === 0
    const startExtra = completedToday ? onStartExtra : undefined
    return (
      <div className="study-overlay complete-overlay">
        <div className="completion-card">
          <div className="completion-mark"><Icon name="check" size={31} /></div>
          <p className="eyebrow">SESSION COMPLETE</p>
          <h1>{completedToday ? '今天的学习计划已完成' : summary.total ? '今天的记忆已经重新连上。' : '现在没有需要完成的训练。'}</h1>
          {completedToday
            ? <p>{startExtra ? '要不要再学一小组新表达？' : '今天先学到这里，明天再来复习。'}</p>
            : <p>{summary.total ? '真正困难的内容已经安排在更合适的时间再次出现。' : '稍后再来，或先添加一个你想记住的表达。'}</p>}
          <div className="completion-stats">
            <div><strong>{savedItemIds.current.size}</strong><span>本轮练习表达</span></div>
            <div><strong>{savedQuestionIds.current.size}</strong><span>本轮题量</span></div>
            <div><strong>{summary.total}</strong><span>已保存作答次数（含重试）</span></div>
          </div>
          {failedWords.length > 0 && (
            <div className="failed-word-strip">
              <span>很快会再出现</span>
              <div>{failedWords.slice(0, 5).map((word) => <em key={word}>{word}</em>)}</div>
            </div>
          )}
          <div className="completion-weekly">
            <Icon name="spark" size={18} /> <SessionElapsedText timer={timer} />
          </div>
          {learningStats && <p>双向可回忆 {learningStats.recallCount} 个 · 保持已验证 {learningStats.retainedCount} 个 · 应用通过 {learningStats.applicationCount} 个</p>}
          {timer.error && <p role="alert">学习时间未保存：{timer.error}<button onClick={() => void timer.flush()} type="button">重试保存时间</button></p>}
          {failedSaves.length > 0 && (
            <div className="save-error-panel" role="alert">
              <p>{failedSaves.length} 条复习结果未保存（{failedSaves.map((failed) => failed.label).join('、')}）。{failedSaves[0]?.message}</p>
              <button className="secondary-button" disabled={pendingWrites > 0} onClick={() => void retryFailedSaves()} type="button">重试保存</button>
            </div>
          )}
          {startExtra && (
            <button className="primary-button large" disabled={flushingExit} onClick={() => void requestExit(startExtra)} type="button">
              再学一组
            </button>
          )}
          <button
            className={startExtra ? 'secondary-button' : 'primary-button large'}
            disabled={flushingExit || failedSaves.length > 0}
            onClick={() => void requestExit()}
            type="button"
          >
            {flushingExit ? '正在保存…' : failedSaves.length > 0 ? '请先重试保存' : startExtra ? '今天先到这里' : '回到今天'}
          </button>
        </div>
      </div>
    )
  }

  if (!task || !item || !track) return null

  const progress = Math.round((index / Math.max(1, tasks.length)) * 100)
  const prompt = buildPrompt(task, item, usagePrompt)

  return (
    <div className="study-overlay">
      <header className="study-header">
        <button aria-label="退出训练" className="icon-button" disabled={flushingExit || pendingWrites > 0 || failedSaves.length > 0} onClick={() => void requestExit()} type="button"><Icon name="close" size={20} /></button>
        <div className="study-progress-wrap">
          <div className="study-progress-copy"><span>{mode === 'core' ? '今日学习' : '继续学习'}</span><span>{index + 1} / {tasks.length}</span></div>
          <div className="study-progress"><span style={{ width: `${progress}%` }} /></div>
        </div>
        <SessionClock timer={timer} />
        <button className="mini-text-button" onClick={() => { if (!paused) timer.setRunning(false); setPaused(!paused) }} type="button">{paused ? '恢复学习' : '暂停'}</button>
      </header>

      <main className="study-main">
        {difficultyLevel && <p className="study-timer-notice" role="status">普通新词目标 {difficultyLevel} · 当前义项 {getVocabularyDifficulty(item).level}{getVocabularyDifficulty(item).source === 'estimated' ? '（估算）' : getVocabularyDifficulty(item).source === 'profile' ? '（词头参考）' : ''}</p>}
        {rebuildError && !rebuildMode && <p className="form-note" role="alert">{rebuildError}</p>}
        {queueRetry && <div className="save-error-panel" role="alert"><p>当前操作已保存，下一组词汇尚未更新：{queueRetry.message}</p><button className="secondary-button" disabled={pendingWrites > 0} onClick={() => void retryQueue()} type="button">重试更新词汇</button></div>}
        {(paused || timer.idle) && <p className="study-timer-notice" role="status">{paused ? '学习已暂停，恢复后继续计时。' : '120 秒无操作，已自动暂停计时；操作后恢复。'}</p>}
        {timer.error && <div className="save-error-panel" role="alert"><p>学习时间未保存，已暂停：{timer.error}</p><button className="secondary-button" onClick={() => void timer.flush()} type="button">重试保存时间</button></div>}
        {failedSaves.length > 0 && (
          <div className="save-error-panel study-save-error" role="alert">
            <p>{failedSaves.length} 条复习结果未保存（{failedSaves.map((failed) => failed.label).join('、')}）。{failedSaves[0]?.message}</p>
            <button className="secondary-button" disabled={flushingExit || pendingWrites > 0} onClick={() => void retryFailedSaves()} type="button">重试保存</button>
          </div>
        )}
        <fieldset className="study-controls" disabled={paused || Boolean(timer.error) || pendingWrites > 0 || failedSaves.length > 0 || Boolean(queueRetry)}>
        <section className={phase === 'feedback' ? 'recall-card feedback' : 'recall-card'} aria-live="polite">
          {phase === 'question' ? (
            <>
              <div className="recall-card-meta">
                <span className={`direction-chip ${task.trackType}`}>{trackLabels[task.trackType]}</span>
                <div className="recall-card-tools">
                  <span>{prompt.direction}</span>
                  {onMarkKnown && <button className="text-button" disabled={grading || hinting || ensuringUsage || flushingExit} onClick={() => void markKnown(task)} type="button">这个词已会，跳过</button>}
                </div>
              </div>
              <div className="prompt-block">
                <p className="prompt-instruction">{prompt.instruction}</p>
                <h1>{prompt.title}</h1>
                {prompt.context && <p className="prompt-context">{prompt.context}</p>}
                {task.trackType === 'receptive' && (item.ipaUk || item.ipaUs) && (
                  <span className="prompt-phonetic">/{item.ipaUk || item.ipaUs}/ · {item.partOfSpeech}</span>
                )}
              </div>

              {ensuringUsage && task.trackType === 'usage' && (
                <p className="field-help">正在生成使用题…</p>
              )}
              {usageEnsureError && task.trackType === 'usage' && (
                <p className="field-help" role="alert">{usageEnsureError}</p>
              )}

              {hintLevel > 0 && (
                <div className="hint-box">
                  <span>提示 {hintLevel}/2</span>
                  <p>{hintText || buildHint(task, item, hintLevel, usagePrompt)}</p>
                </div>
              )}

              <div className="answer-area">
                <label htmlFor="recall-answer">{prompt.answerLabel}</label>
                {isSentence ? (
                  <textarea
                    disabled={ensuringUsage || grading || hinting}
                    id="recall-answer"
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitAnswer()
                    }}
                    placeholder={prompt.placeholder}
                    ref={(node) => { inputRef.current = node }}
                    rows={4}
                    value={answer}
                  />
                ) : (
                  <input
                    autoComplete="off"
                    disabled={ensuringUsage || grading || hinting}
                    id="recall-answer"
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') submitAnswer() }}
                    placeholder={prompt.placeholder}
                    ref={(node) => { inputRef.current = node }}
                    value={answer}
                  />
                )}
              </div>

              <div className="recall-actions">
                <div>
                  <button className="hint-button" disabled={hintLevel >= 2 || hinting || grading || ensuringUsage} onClick={() => void requestHint()} type="button">
                    <Icon name="spark" size={17} /> {hinting ? '生成提示…' : hintLevel ? '再给一点提示' : '给一点提示'}
                  </button>
                  <button
                    className="forgot-button"
                    disabled={
                      grading
                      || hinting
                      || ensuringUsage
                      || (task.trackType === 'usage' && item.usagePrompts.length === 0)
                    }
                    onClick={() => void showForgottenAnswer()}
                    type="button"
                  >
                    想不起来
                  </button>
                </div>
                <button className="primary-button" disabled={!answer.trim() || grading || hinting || ensuringUsage} onClick={() => void submitAnswer()} type="button">
                  {ensuringUsage ? '准备题目…' : grading ? '判分中…' : '提交回忆'} <Icon name="arrow" size={18} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="feedback-topline">
                <span className={`feedback-signal ${evaluation?.rating}`}>
                  <Icon name={evaluation?.rating === 'good' ? 'check' : evaluation?.rating === 'hard' ? 'refresh' : 'brain'} size={18} />
                  {evaluation?.correctness === 'unverified' ? '本次结果尚未验证' : evaluation?.correctness === 'correct' ? (evaluation.matchKind === 'minor-typo' ? '意思正确，有轻微拼写错误' : hintLevel > 0 ? '借助提示答对了' : '无提示回忆正确') : evaluation?.rating === 'good' ? '无提示想起来了' : evaluation?.rating === 'hard' ? '接近了，再加固一次' : '现在忘记很正常'}
                </span>
                <div className="speech-controls">
                  <div className="accent-toggle" role="group" aria-label="发音口音">
                    <button
                      aria-pressed={accent === 'uk'}
                      className={`mini-text-button${accent === 'uk' ? ' is-active' : ''}`}
                      onClick={() => chooseAccent('uk')}
                      type="button"
                    >
                      UK
                    </button>
                    <button
                      aria-pressed={accent === 'us'}
                      className={`mini-text-button${accent === 'us' ? ' is-active' : ''}`}
                      onClick={() => chooseAccent('us')}
                      type="button"
                    >
                      US
                    </button>
                  </div>
                  <button aria-label={`播放 ${item.expression}`} className="audio-button" onClick={() => void speakWord(item, accent)} type="button"><Icon name="volume" size={19} /> 再听一次</button>
                </div>
              </div>

              <div className="answer-reveal">
                <span>目标表达</span>
                <h1>{item.expression}</h1>
                {(item.ipaUk || item.ipaUs) && <p>/{item.ipaUk || item.ipaUs}/ · {item.partOfSpeech}</p>}
                <strong>{item.zhGloss}</strong>
                {item.enDefinition && <p className="reveal-definition">{item.enDefinition}</p>}
              </div>

              {answer && <div className="your-answer"><span>你的回答</span><p>{answer}</p></div>}

              {evaluation?.feedbackZh && (
                <div className="ai-feedback">
                  <span>{evaluation.source === 'llm' ? 'AI 辅助反馈' : '验证说明'}</span>
                  <p>{evaluation.feedbackZh}</p>
                </div>
              )}
              {isSentence && !revealed && (
                <div className="sentence-verification">
                  <p>{evaluation?.source === 'llm' && evaluation.correctness !== 'unverified' ? '已完成 AI 辅助检查；这不等同于真实场景迁移能力。' : '本地只检查范句或关键词，造句能力仍待验证。'}</p>
                  {canVerifySentence ? <button className="secondary-button" disabled={verificationRequested || grading} onClick={() => void runEvaluation(false, true)} type="button">{grading ? 'AI 验证中…' : verificationRequested ? '本次 AI 验证已请求' : '请 AI 验证本句'}</button> : <p className="field-help">配置 DeepSeek Key 后，可按需验证本句。</p>}
                </div>
              )}

              {isSentence && usagePrompt ? (
                <div className="model-answer">
                  <span>自然范例</span>
                  <p>{usagePrompt.modelAnswer}</p>
                  <ul>{usagePrompt.checkpoints.map((checkpoint) => <li key={checkpoint}><Icon name="check" size={15} /> {checkpoint}</li>)}</ul>
                </div>
              ) : (
                <div className="context-reveal">
                  <div>
                    <span>IN CONTEXT</span>
                    <p>{item.examples[(track.reps + index) % Math.max(1, item.examples.length)]?.en ?? '还没有例句，可以稍后在词库中补充。'}</p>
                    {item.examples[(track.reps + index) % Math.max(1, item.examples.length)]?.zh && <small>{item.examples[(track.reps + index) % item.examples.length].zh}</small>}
                  </div>
                  {item.collocations.length > 0 && <div className="collocation-list">{item.collocations.slice(0, 3).map((value) => <em key={value}>{value}</em>)}</div>}
                </div>
              )}

              {needsCorrection && (
                <label className="correction-field">
                  <span>看完答案后，再正确输入一次</span>
                  <input autoComplete="off" onChange={(event) => setCorrection(event.target.value)} placeholder={expressionHint(correctionTarget, 1)} value={correction} />
                  {correction && !correctionComplete && <small>还差一点，注意完整拼写。</small>}
                  {correctionComplete && <small className="corrected"><Icon name="check" size={14} /> 已正确输入</small>}
                </label>
              )}

              {task.trackType === 'receptive' && evaluation?.rating === 'again' && !revealed && (
                <p className="override-note">中文表达可能不同。如果意思确实相同，可以在下面改为“想起来了”。</p>
              )}

              <div className="rating-block">
                <p>这次实际想起到什么程度？</p>
                <div className="rating-buttons">
                  <button className={evaluation?.rating === 'again' ? 'rating-button again recommended' : 'rating-button again'} disabled={grading || !correctionComplete} onClick={() => void chooseRating('again')} type="button">
                    <strong>忘记了</strong><span>很快再练</span>
                  </button>
                  <button className={evaluation?.rating === 'hard' ? 'rating-button hard recommended' : 'rating-button hard'} disabled={grading || revealed || !correctionComplete} onClick={() => void chooseRating('hard')} type="button">
                    <strong>有点模糊</strong><span>缩短间隔</span>
                  </button>
                  <button className={evaluation?.rating === 'good' ? 'rating-button good recommended' : 'rating-button good'} disabled={grading || revealed || hintLevel > 0 || needsCorrection} onClick={() => void chooseRating('good')} type="button">
                    <strong>想起来了</strong><span>正常间隔</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
        </fieldset>
      </main>
    </div>
  )
}

function buildPrompt(task: SessionTask, item: VocabularyItem, usagePrompt?: VocabularyItem['usagePrompts'][number]) {
  if (task.trackType === 'receptive') {
    return {
      direction: 'English → 中文',
      instruction: '根据语境回忆这个词在本题中的意思，不用翻译整句。',
      title: item.expression,
      context: recallContext(item) || `${item.partOfSpeech} · ${categoryLabels[item.category]}`,
      answerLabel: '你记得的中文意思',
      placeholder: '用自己的中文表达即可',
    }
  }
  if (task.trackType === 'productive') {
    return {
      direction: '中文 / 场景 → English',
      instruction: '不看选项，从中文意思主动写出英文。',
      title: item.zhGloss,
      context: item.examples[0]?.zh ?? '',
      answerLabel: '完整英文表达',
      placeholder: 'Type the expression from memory',
    }
  }
  return {
    direction: usagePrompt?.type === 'sentence' ? '场景 → 自己造句' : '语境 → 填入表达',
    instruction: usagePrompt?.type === 'sentence'
      ? '写一个能在真实生活中直接说出口的句子。'
      : '根据完整语境，从记忆里填入最自然的表达。',
    title: usagePrompt?.prompt ?? `用 ${item.expression} 写一句话`,
    context: usagePrompt?.type === 'sentence' ? `本题义项：${item.zhGloss}` : '',
    answerLabel: usagePrompt?.type === 'sentence' ? '你的句子' : '缺少的英文表达',
    placeholder: usagePrompt?.type === 'sentence' ? `Use “${item.expression}” in your sentence` : 'Type the missing expression',
  }
}

function buildHint(
  task: SessionTask,
  item: VocabularyItem,
  level: HintLevel,
  usagePrompt?: VocabularyItem['usagePrompts'][number],
) {
  if (task.trackType === 'receptive') {
    if (level === 1) return `${item.partOfSpeech} · ${item.enDefinition}`
    return item.examples[0]?.en ?? '想想你第一次遇见它的场景。'
  }
  if (level === 1) return expressionHint(item.expression, 1)
  if (task.trackType === 'usage' && usagePrompt?.modelAnswer) {
    return usagePrompt.modelAnswer.replace(new RegExp(escapeRegExp(item.expression), 'gi'), '_____')
  }
  return item.examples[0]?.en.replace(new RegExp(escapeRegExp(item.expression), 'gi'), '_____')
    ?? expressionHint(item.expression, 2)
}

function normalize(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function answerMatches(value: string, target: string, alternatives: string[]) {
  const candidate = normalize(value)
  return [target, ...alternatives].some((answer) => normalize(answer) === candidate)
}


/** Live mm:ss clock; isolated so timer ticks never re-render the session tree. */
function SessionClock({ timer }: { timer: StudyTimerApi }) {
  const elapsedMs = useSyncExternalStore(timer.subscribeElapsed, timer.getElapsed)
  return (
    <span className="study-time" aria-label="本轮学习计时">
      <Icon name="clock" size={17} /> {Math.floor(elapsedMs / 60_000)}:{String(Math.floor(elapsedMs / 1000) % 60).padStart(2, '0')}
    </span>
  )
}

function SessionElapsedText({ timer }: { timer: StudyTimerApi }) {
  const elapsedMs = useSyncExternalStore(timer.subscribeElapsed, timer.getElapsed)
  return <>本轮有效学习 {Math.floor(elapsedMs / 60_000)} 分 {Math.floor(elapsedMs / 1000) % 60} 秒</>
}
