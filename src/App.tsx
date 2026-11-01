import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CustomItemDraft } from './components/AddView'
import { AppShell, type AppTab } from './components/AppShell'
import type { EvaluationResult, RateDetail } from './components/StudySession'
import { TodayView } from './components/TodayView'
import type { AccountControls } from './components/AccountDataSection'
import { saveVoiceExpression, type VoiceExpressionDraft } from './lib/voice/review'
import { buildFirstLessonPlan } from './lib/onboarding'
import { handcraftedSeedMemberships, handcraftedSeedWords, loadSeedPack } from './data/seedVocabulary'
import { DICTIONARY_CONTENT_REVISION } from './data/dictionaryContentRevision'
import { loadBundledDictionarySenses } from './data/dictionarySenses'
import { ALL_VOCABULARY_LISTS, listIdForSlug } from './data/vocabularyLists'
import {
  DEFAULT_SETTINGS,
  hydrateWord,
  normalizeLemma,
  primaryListSlug,
  type HintLevel,
  type DictionaryResult,
  type LearningTrack,
  type ListSlug,
  type ReviewAttempt,
  type ReviewRating,
  type SessionTask,
  type StudyTimeEntry,
  type SystemListSlug,
  type UserSettings,
  type VocabularyItem,
  type Word,
  type WordListItem,
} from './domain/types'
import { exportBackupJson, importBackup, markBackupExported } from './lib/backup'
import {
  resolveListSlugsForEdit,
  type EditCategory,
} from './lib/listMembership'
import {
  exportVocabularyPackJson,
  importVocabularyPack,
} from './lib/vocabularyPack'
import {
  addWordToList,
  clearDatabase,
  getLibrarySeedStatus,
  getAllReviewAttempts,
  getSettings,
  getUserDataSnapshot,
  getWordListItemsForWord,
  initializeDatabase,
  putSettings,
  putStudyTimeEntry,
  patchWord,
  recordReview,
  removeWordFromList,
  writeBatch,
} from './lib/db'
import { lookupDictionary } from './lib/dictionary'
import { applyBundledDictionarySenses, saveDictionarySenses, type DictionarySenseEdit } from './lib/wordSenses'
import { prepareVocabularyImportRow, type ImportCategory, type VocabularyImportRow, type VocabularyImportSummary } from './lib/vocabularyImport'
import { evaluateAssist } from './lib/llm/evaluateAssist'
import { hasDeepseekApiKey } from './lib/llm/config'
import { hintWithLlm } from './lib/llm/hints'
import { createSerialQueue } from './lib/serialQueue'
import { showToast } from './lib/toast'
import { escapeRegExp, expressionKey, uniqueStrings } from './lib/text'
import { normalizeChinese } from './lib/grading'
import { enrichWithLlm } from './lib/llm/enrich'
import {
  buildFallbackUsagePrompts,
  generateUsagePromptsWithLlm,
} from './lib/llm/usageGenerate'
import {
  snapshotLearningTracks,
  snapshotMapLearningProgress,
} from './lib/learningTracks'
import { deriveLearningStats } from './lib/learningStats'
import { getStudyDifficulty, isNewLearningTask, refreshPendingNewTasks } from './lib/studyDifficulty'
import {
  buildDailyPlan,
  createInitialTracks,
  type DailyPlan,
} from './lib/scheduler'

interface ActiveSession {
  id: string
  plan: DailyPlan
  firstLesson?: boolean
}

const AddView = lazy(() => import('./components/AddView').then(module => ({ default: module.AddView })))
const LibraryView = lazy(() => import('./components/LibraryView').then(module => ({ default: module.LibraryView })))
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then(module => ({ default: module.SettingsDialog })))
const StudySession = lazy(() => import('./components/StudySession').then(module => ({ default: module.StudySession })))
const VoicePractice = lazy(() => import('./components/VoicePractice').then(module => ({ default: module.VoicePractice })))
const OnboardingDialog = lazy(() => import('./components/OnboardingDialog').then(module => ({ default: module.OnboardingDialog })))
const MembershipPlans = lazy(() => import('./components/MembershipPlans').then(module => ({ default: module.MembershipPlans })))
const pageFallback = <p role="status">正在打开页面…</p>
const studyFallback = <div className="study-overlay" role="status">正在准备训练…</div>
const settingsFallback = <div className="dialog-backdrop" role="status">正在打开设置…</div>

interface AppProps {
  account?: AccountControls
  dataReady?: boolean
  onReady?: () => void
  onBusyChange?: (busy: boolean) => void
  onRequestLogin?: () => void
  initialTab?: AppTab
  onTabChange?: (tab: AppTab) => void
}

function App({ onReady, onBusyChange, onRequestLogin, initialTab = 'today', onTabChange, account, dataReady = true }: AppProps = {}) {
  const [tab, setTab] = useState<AppTab>(initialTab)
  const preview = Boolean(onRequestLogin)
  const [items, setItems] = useState<VocabularyItem[]>([])
  const [tracks, setTracks] = useState<LearningTrack[]>([])
  const [attempts, setAttempts] = useState<ReviewAttempt[]>([])
  const [timeEntries, setTimeEntries] = useState<StudyTimeEntry[]>([])
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [dictionaryWarning, setDictionaryWarning] = useState('')
  const [dictionaryBusy, setDictionaryBusy] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const enqueueReviewWrite = useRef(createSerialQueue()).current
  const sessionDifficulty = useRef<string>('B1')

  const refreshData = useCallback(async () => {
    const snapshot = await getUserDataSnapshot()
    setItems(snapshot.vocabulary)
    setTracks(snapshot.tracks)
    setAttempts(snapshot.attempts)
    setTimeEntries(snapshot.timeEntries)
    setSettings(snapshot.settings)
  }, [])

  useEffect(() => {
    if (preview) return
    const refresh = () => { void refreshData().catch(() => setLoadError('无法读取同步后的学习数据，请重新载入。')) }
    window.addEventListener('recall-cloud-data-applied', refresh)
    return () => window.removeEventListener('recall-cloud-data-applied', refresh)
  }, [refreshData, preview])
  useEffect(() => { if (!loading && !loadError) onReady?.() }, [loading, loadError, onReady])
  useEffect(() => { onBusyChange?.(Boolean(session || settingsOpen || onboardingOpen)) }, [session, settingsOpen, onboardingOpen, onBusyChange])

  const syncDictionaryContent = useCallback(async () => {
    setDictionaryBusy(true)
    try {
      try {
        await applyBundledDictionarySenses(await loadBundledDictionarySenses())
        setDictionaryWarning('')
      } catch (error) {
        setDictionaryWarning(error instanceof Error ? error.message : '词义资料暂时无法加载。')
      }
      await refreshData()
    } finally { setDictionaryBusy(false) }
  }, [refreshData])

  useEffect(() => {
    let active = true
    async function boot() {
      try {
        if (preview) {
          const seed = await loadSeedPack()
          if (!active) return
          const lists = new Map(ALL_VOCABULARY_LISTS.map(list => [list.id, list.slug]))
          const memberships = new Map<string, ListSlug[]>()
          for (const membership of seed.memberships) {
            const slug = lists.get(membership.listId)
            if (slug) memberships.set(membership.wordId, [...(memberships.get(membership.wordId) ?? []), slug])
          }
          const vocabulary = seed.words.map(word => hydrateWord(word, memberships.get(word.id) ?? []))
          setItems(vocabulary)
          setTracks(createInitialTracks(vocabulary))
          return
        }
        // Returning users skip the ~12 MB seed pack: it is only fetched when
        // the library is empty or the stored seed revision has changed.
        const { needsBundledSeed } = await getLibrarySeedStatus()
        const seed = needsBundledSeed
          ? await loadSeedPack()
          : { words: handcraftedSeedWords, memberships: handcraftedSeedMemberships }
        await initializeDatabase(
          seed.words,
          seed.memberships,
          undefined,
          DEFAULT_SETTINGS,
          ALL_VOCABULARY_LISTS,
        )
        if (!active) return
        if ((await getSettings()).dictionaryContentRevision !== DICTIONARY_CONTENT_REVISION) {
          await syncDictionaryContent()
        } else await refreshData()
        if (!active) return
      } catch (error) {
        if (!active) return
        setLoadError(error instanceof Error ? error.message : '无法打开本地学习数据。')
      } finally {
        if (active) setLoading(false)
      }
    }
    void boot()
    return () => { active = false }
  }, [refreshData, syncDictionaryContent, preview])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  // Delayed recall uses a sliding seven-day window, including within-day boundaries.
  const stats = useMemo(() => deriveLearningStats({ items, tracks, attempts, timeEntries, now }), [items, tracks, attempts, timeEntries, now])
  const dailyPlan = useMemo(() => buildDailyPlan({ settings, items, tracks, attempts, timeEntries, now }), [settings, items, tracks, attempts, timeEntries, now])
  const difficulty = useMemo(() => getStudyDifficulty(settings, items, attempts, now), [settings, items, attempts, now])

  const learningTrackSnapshots = useMemo(() => {
    const learnedItemIds = new Set(
      tracks.filter((track) => track.reps > 0).map((track) => track.itemId),
    )
    return snapshotLearningTracks(items, learnedItemIds)
  }, [items, tracks])

  const mapProgress = useMemo(() => {
    const stageByItemId = new Map(
      items.map((item) => [
        item.id,
        stats.evidenceByItemId.get(item.id)?.key ?? 'new',
      ] as const),
    )
    return snapshotMapLearningProgress(items, stageByItemId)
  }, [items, stats.evidenceByItemId])

  const recentWords = useMemo(() => {
    const seen = new Set<string>()
    return [...attempts]
      .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime())
      .flatMap((attempt) => {
        if (seen.has(attempt.itemId)) return []
        const item = itemMap.get(attempt.itemId)
        if (!item) return []
        seen.add(attempt.itemId)
        return [{
          expression: item.expression,
          zhGloss: item.zhGloss,
          stage: ({ new: '未开始', learning: '正在练习', recall: '能双向想起', retained: '隔几天仍记得' })[stats.evidenceByItemId.get(item.id)?.key ?? 'new'],
        }]
      })
      .slice(0, 6)
  }, [attempts, itemMap, stats.evidenceByItemId])

  function startSession() {
    if (onRequestLogin) { onRequestLogin(); return }
    const current = new Date()
    if (current.toDateString() !== now.toDateString()) {
      void rebuildSession()
      return
    }
    sessionDifficulty.current = difficulty.level
    setSession({ id: makeId('session'), plan: dailyPlan })
  }

  async function rebuildSession() {
    try {
      const snapshot = await getUserDataSnapshot()
      const current = new Date()
      const plan = buildDailyPlan({ settings: snapshot.settings, items: snapshot.vocabulary, tracks: snapshot.tracks, attempts: snapshot.attempts, timeEntries: snapshot.timeEntries, now: current })
      setItems(snapshot.vocabulary)
      setTracks(snapshot.tracks)
      setAttempts(snapshot.attempts)
      setTimeEntries(snapshot.timeEntries)
      setSettings(snapshot.settings)
      setNow(current)
      setSessionError('')
      sessionDifficulty.current = getStudyDifficulty(snapshot.settings, snapshot.vocabulary, snapshot.attempts, current).level
      setSession({ id: makeId('session'), plan })
      return true
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : '暂时无法读取学习计划，请重试。')
      return false
    }
  }

  const saveStudyTime = useCallback(async (entry: StudyTimeEntry) => {
    const saved = await putStudyTimeEntry(entry)
    setTimeEntries((current) => [...current.filter((candidate) => candidate.id !== saved.id), saved])
  }, [])

  const evaluateTask = useCallback(async (
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
  ): Promise<EvaluationResult> => {
    const result = await evaluateAssist({
      item,
      trackType: task.trackType,
      answer,
      hintLevel,
      responseMs,
      revealed,
      promptIndex: task.promptIndex,
      verifySentence: options?.verifySentence,
      onInterim: options?.onInterim,
    })
    return result
  }, [])

  const resolveHint = useCallback(async (
    task: SessionTask,
    item: VocabularyItem,
    hintLevel: HintLevel,
  ) => {
    if (!hasDeepseekApiKey()) {
      throw new Error('no-key')
    }
    return hintWithLlm({
      item,
      trackType: task.trackType,
      hintLevel,
      promptIndex: task.promptIndex,
    })
  }, [])

  const ensureUsageItem = useCallback(async (item: VocabularyItem) => {
    if (item.usagePrompts.length >= 2) return item
    let prompts = item.usagePrompts
    try {
      if (hasDeepseekApiKey()) {
        prompts = await generateUsagePromptsWithLlm(item)
      } else {
        prompts = buildFallbackUsagePrompts(item.expression, item.examples[0]?.en)
      }
    } catch {
      prompts = buildFallbackUsagePrompts(item.expression, item.examples[0]?.en)
    }
    const updated: VocabularyItem = { ...item, ...await patchWord(item.id, { usagePrompts: prompts }) }
    setItems((current) => current.map((candidate) => (
      candidate.id === updated.id ? { ...updated, listSlugs: candidate.listSlugs, category: candidate.category } : candidate
    )))
    return updated
  }, [])


  async function handleRate(
    task: SessionTask,
    rating: ReviewRating,
    detail: RateDetail,
  ) {
    const result = await enqueueReviewWrite(() => recordReview({
      trackId: task.trackId,
      rating,
      reviewedAt: new Date(detail.reviewedAt),
      desiredRetention: settings.desiredRetention,
      attempt: {
        id: detail.attemptId,
        itemId: task.itemId,
        trackType: task.trackType,
        promptType: detail.promptType,
        answer: detail.answer,
        hintLevel: detail.hintLevel,
        responseMs: detail.responseMs,
        wasOverride: detail.wasOverride || undefined,
        evidenceVersion: detail.evidenceVersion,
        sessionId: detail.sessionId,
        retryCount: detail.retryCount,
        promptId: detail.promptId,
        evaluationSource: detail.evaluationSource,
        correctness: detail.correctness,
        matchKind: detail.matchKind,
        suggestedRating: detail.suggestedRating,
        wasPriorityStudy: itemMap.get(task.itemId)?.listSlugs.includes('my-vocabulary') ?? false,
        wasNewItem: isNewLearningTask(task, tracks, attempts),
      },
    }))
    const changedById = new Map(result.tracks.map((track) => [track.id, track]))
    setTracks((current) => current.map((track) => changedById.get(track.id) ?? track))
    setAttempts((current) => [...current.filter((attempt) => attempt.id !== result.attempt.id), result.attempt])
    setNow(new Date())
  }

  async function toggleKnown(item: VocabularyItem) {
    const updated = await patchWord(item.id, { knownAt: item.knownAt ? undefined : new Date().toISOString() })
    setItems((previous) => previous.map((word) => word.id === updated.id ? { ...word, ...updated } : word))
    setNow(new Date())
  }

  async function refreshSessionTasks(pending: SessionTask[], started: ReadonlySet<string>, force: boolean) {
    if (!force) {
      const [savedAttempts, savedSettings] = await Promise.all([getAllReviewAttempts(), getSettings()])
      if (getStudyDifficulty(savedSettings, items, savedAttempts).level === sessionDifficulty.current) return pending
    }
    const snapshot = await getUserDataSnapshot()
    const current = new Date()
    const nextDifficulty = getStudyDifficulty(snapshot.settings, snapshot.vocabulary, snapshot.attempts, current)
    const plan = (session?.firstLesson ? buildFirstLessonPlan : buildDailyPlan)({ settings: snapshot.settings, items: snapshot.vocabulary, tracks: snapshot.tracks, attempts: snapshot.attempts, timeEntries: snapshot.timeEntries, now: current })
    const next = refreshPendingNewTasks(pending, plan.tasks, snapshot.vocabulary, started)
    sessionDifficulty.current = nextDifficulty.level
    return next
  }

  async function addCustomItem(draft: CustomItemDraft) {
    const duplicate = items.some((item) => (
      normalizeText(item.expression) === normalizeText(draft.expression)
      && normalizeText(item.zhGloss) === normalizeText(draft.zhGloss)
    ))
    if (duplicate) return { ok: false, message: '这个表达的相同义项已经在词库中。你可以直接编辑原词条。' }

    const { word, memberships, item } = customItemFromDraft(draft)
    const itemTracks = createInitialTracks([word], new Date())
    await writeBatch({ words: [word], memberships, tracks: itemTracks })
    setItems((current) => [item, ...current])
    setTracks((current) => [...current, ...itemTracks])
    return { ok: true, message: `已把 “${item.expression}” 加入优先学习。` }
  }

  async function saveDictionaryEntry(result: DictionaryResult, selectedIndices: number[], category: SystemListSlug | 'other' | 'auto', scenarioNote?: string, preserveExistingTraining = false, edits?: DictionarySenseEdit[]) {
    const summary = await saveDictionarySenses(result, selectedIndices, category, scenarioNote, { preserveExistingTraining, edits })
    await refreshData()
    return { ok: true, message: `已保存 “${result.word}” 的词义：新增 ${summary.added} 个，选定训练 ${summary.activated} 个；其他新增义项默认暂停。` }
  }

  async function completeSenses(item: VocabularyItem) {
    const result = await lookupDictionary(item.expression)
    const category = item.category === 'my-vocabulary'
      ? item.scenarioNote?.trim() ? 'other' : 'daily'
      : item.category
    return saveDictionaryEntry(result, [], category, item.scenarioNote)
  }

  async function addToMyVocabulary(item: VocabularyItem) {
    try {
      if (!item.zhGloss.trim()) return { ok: false as const, message: '请先编辑补充中文义项，再加入训练。' }
      await addWordToList(item.id, 'my-vocabulary', item.priority)
      await refreshData()
      return { ok: true as const, message: `已加入优先学习：${item.expression}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : '加入优先学习失败。'
      showToast(message, 'error')
      return { ok: false as const, message }
    }
  }

  async function removeFromMyVocabulary(item: VocabularyItem) {
    try {
      await removeWordFromList(item.id, 'my-vocabulary')
      await refreshData()
      return { ok: true as const, message: `已移除优先学习：${item.expression}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : '移除优先学习失败。'
      showToast(message, 'error')
      return { ok: false as const, message }
    }
  }

  async function bulkAdd(
    rows: VocabularyImportRow[],
    category: ImportCategory,
    onProgress?: (completed: number, total: number) => void,
    retry = false,
  ) {
    const original = await getUserDataSnapshot()
    const preserveExistingTrainingIds = new Set(original.words.map((word) => word.id))
    const seen = new Set<string>()
    const lookups = new Map<string, Promise<DictionaryResult>>()
    const summary: VocabularyImportSummary = { added: 0, skipped: 0, sensesAdded: 0, failed: [], enrichmentFailed: [], warnings: [] }
    const lookup = (expression: string) => {
      const key = expressionKey(expression)
      let pending = lookups.get(key)
      if (!pending) {
        pending = retry ? lookupDictionary(expression, { forceRefresh: true, timeoutMs: 15_000 }) : lookupDictionary(expression)
        lookups.set(key, pending)
      }
      return pending
    }
    const batchSize = retry ? 1 : 3
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize)
      const prepared = await Promise.allSettled(batch.map((row) => prepareVocabularyImportRow(row, lookup, category)))
      for (const [index, row] of batch.entries()) {
        const key = JSON.stringify([expressionKey(row.expression), expressionKey(row.zhGloss), row.partOfSpeech ?? '', row.category ?? category, expressionKey(row.enDefinition ?? '')])
        const candidate = prepared[index]
        try {
          if (seen.has(key)) { summary.skipped += 1; continue }
          seen.add(key)
          if (candidate.status === 'rejected') throw candidate.reason
          const entry = candidate.value
          const saved = await saveDictionarySenses(entry.result, entry.selectedIndices, entry.category, undefined,
            { preserveExistingTraining: true, preserveExistingTrainingIds })
          if (saved.added || saved.activated) summary.added += 1
          else summary.skipped += 1
          summary.sensesAdded += saved.added
          if (entry.warning) summary.warnings.push(entry.warning)
          if (entry.enrichmentFailed) summary.enrichmentFailed.push(row)
        } catch (error) {
          summary.failed.push({ row, message: error instanceof Error ? error.message : '补全或保存失败，请重试。' })
        } finally { onProgress?.(start + index + 1, rows.length) }
      }
    }
    await refreshData()
    return summary
  }

  async function toggleStatus(item: VocabularyItem) {
    if (item.status === 'paused' && !item.zhGloss.trim()) {
      showToast('请先编辑补充中文义项，再恢复训练。', 'error')
      return
    }
    let updatedWord: Word
    try {
      updatedWord = await patchWord(item.id, { status: item.status === 'active' ? 'paused' : 'active' })
    } catch (error) {
      showToast(error instanceof Error ? `保存暂停状态失败：${error.message}` : '保存暂停状态失败。', 'error')
      return
    }
    setItems((current) => current.map((candidate) => (
      candidate.id === item.id
        ? { ...candidate, ...updatedWord, listSlugs: candidate.listSlugs, category: candidate.category }
        : candidate
    )))
  }

  async function updateItem(
    id: string,
    patch: {
      zhGloss: string
      enDefinition: string
      partOfSpeech: string
      examples: VocabularyItem['examples']
      collocations: string[]
      category: EditCategory
      scenarioNote?: string
      vocabularyLevel?: VocabularyItem['vocabularyLevel']
      expectedWord?: VocabularyItem
    },
  ) {
    const current = items.find((item) => item.id === id)
    if (!current) return
    const usagePrompts = current.usagePrompts.length
      ? current.usagePrompts
      : buildUsagePrompts(current.expression, patch.examples)
    const listSlugs = resolveListSlugsForEdit(current.listSlugs, current.category, patch.category)
    const { category: _editCategory, scenarioNote: patchScenarioNote, expectedWord, ...contentPatch } = patch
    const scenarioNote = patch.category === 'other'
      ? (patchScenarioNote?.trim() || current.scenarioNote)
      : undefined
    const glossChanged = normalizeChinese(patch.zhGloss) !== normalizeChinese(current.zhGloss)
    const acceptedZhAnswers = glossChanged
      ? current.acceptedZhAnswers.filter((answer) => normalizeChinese(answer) !== normalizeChinese(current.zhGloss))
      : current.acceptedZhAnswers
    const contentChanged = patch.zhGloss !== current.zhGloss || patch.enDefinition !== current.enDefinition
      || patch.partOfSpeech !== current.partOfSpeech || JSON.stringify(patch.examples) !== JSON.stringify(current.examples)
      || JSON.stringify(patch.collocations) !== JSON.stringify(current.collocations)
    const updated: VocabularyItem = {
      ...current,
      ...contentPatch,
      listSlugs,
      category: primaryListSlug(listSlugs),
      scenarioNote,
      acceptedZhAnswers: uniqueStrings([patch.zhGloss, ...acceptedZhAnswers]),
      contentEdited: contentChanged || (current.contentEdited ?? current.updatedAt !== current.createdAt),
      usagePrompts,
      updatedAt: new Date().toISOString(),
    }
    const hasUsageTrack = tracks.some((track) => track.itemId === id && track.type === 'usage')
    const newUsageTrack = !hasUsageTrack && usagePrompts.length
      ? createInitialTracks([updated], new Date()).filter((track) => track.type === 'usage')
      : []
    const existingMemberships = await getWordListItemsForWord(id)
    const nextMembershipIds = new Set(listSlugs.map((slug) => `membership-${id}-${slug}`))
    const deleteMembershipIds = existingMemberships
      .filter((membership) => !nextMembershipIds.has(membership.id))
      .map((membership) => membership.id)
    const memberships = listSlugs.map((slug, index) => ({
      id: `membership-${id}-${slug}`,
      wordId: id,
      listId: listIdForSlug(slug),
      priority: updated.priority,
      sortOrder: index,
      subcategory: slug === 'my-vocabulary' ? scenarioNote : undefined,
    }))
    await writeBatch({
      words: [stripHydration(updated)],
      expectedWords: [stripHydration(expectedWord ?? current)],
      memberships,
      deleteMembershipIds,
      tracks: newUsageTrack,
    })
    setItems((all) => all.map((item) => item.id === id ? updated : item))
    if (newUsageTrack.length) setTracks((all) => [...all, ...newUsageTrack])
  }

  async function saveSettings(updated: UserSettings) {
    await putSettings(updated)
    setSettings(updated)
  }

  async function completeOnboarding(updated: UserSettings, start: boolean) {
    await saveSettings(updated)
    if (start) {
      const snapshot = await getUserDataSnapshot()
      const current = new Date()
      const firstLesson = snapshot.attempts.length === 0 && snapshot.tracks.every(track => track.reps === 0)
      const plan = (firstLesson ? buildFirstLessonPlan : buildDailyPlan)({ settings: updated,
        items: snapshot.vocabulary, tracks: snapshot.tracks,
        attempts: snapshot.attempts, timeEntries: snapshot.timeEntries, now: current })
      sessionDifficulty.current = updated.vocabularyLevel ?? 'B1'
      setNow(current)
      setSession({ id: makeId('session'), plan, firstLesson })
    }
    setOnboardingOpen(false)
  }

  async function saveSpokenExpression(draft: VoiceExpressionDraft) {
    if (onRequestLogin) { onRequestLogin(); return }
    await saveVoiceExpression(draft)
    await refreshData()
  }

  async function downloadBackup() {
    try {
      const json = await exportBackupJson()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `recall-english-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      // Stamp only after the download fired, not while building the export.
      await markBackupExported()
      await refreshData()
    } catch (error) {
      showToast(error instanceof Error ? `导出学习备份失败：${error.message}` : '导出学习备份失败。', 'error')
    }
  }

  async function restoreBackup(content: string) {
    try {
      const summary = await importBackup(content)
      await refreshData()
      return {
        ok: true,
        message: `导入完成：${summary.vocabulary} 个义项、${summary.attempts} 次回忆。`,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '备份文件无效，未修改当前数据。',
      }
    }
  }


  async function restoreVocabularyPack(content: string) {
    try {
      const summary = await importVocabularyPack(content)
      await refreshData()
      return {
        ok: true,
        message: `词库合并完成：新增 ${summary.added}、更新 ${summary.updated}、未变 ${summary.unchanged}；新增归属 ${summary.membershipsAdded}。`,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '词库文件无效，未修改当前数据。',
      }
    }
  }

  async function addSharedPowerBankVocabulary() {
    const { default: pack } = await import('../data/shared-power-bank/shared-power-bank.vocabulary.json')
    const summary = await importVocabularyPack(pack)
    await refreshData()
    return { ok: true, message: `已加入共享充电宝工作词库：新增 ${summary.added} 个义项，补全 ${summary.updated} 个，已有 ${summary.unchanged} 个；每日学习数量保持设置值。` }
  }

  if (loading) return <LoadingScreen />
  if (loadError) return <ErrorScreen message={loadError} onRetry={() => window.location.reload()} />

  return (
    <>
      <AppShell
        activeTab={tab}
        onChangeTab={(nextTab) => {
          setTab(nextTab)
          onTabChange?.(nextTab)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {dictionaryWarning && <div className="session-open-error" role="alert">
          <span>词义补全暂未完成，已有词库仍可使用。{dictionaryWarning}</span>
          <button type="button" disabled={dictionaryBusy} onClick={() => void syncDictionaryContent().catch((error) => setDictionaryWarning(error instanceof Error ? error.message : '重试失败。'))}>
            {dictionaryBusy ? '正在补全…' : '重试词义补全'}
          </button>
        </div>}
        {sessionError && <div className="session-open-error" role="alert">
          <span>{sessionError}</span>
          <button type="button" onClick={() => setSessionError('')}>关闭提示后重试</button>
        </div>}
        <Suspense fallback={pageFallback}>
        {tab === 'today' && dataReady && !settings.onboardingCompletedAt && attempts.length === 0 && <section className="panel onboarding-welcome">
          <div><p className="eyebrow">WELCOME TO LOMI</p><h2>先用一小课，找到你的节奏。</h2><p>选一个常用场景，从最多 3 个表达开始。也可以直接浏览词库。</p></div>
          <button className="primary-button" type="button" onClick={() => { if (onRequestLogin) onRequestLogin(); else setOnboardingOpen(true) }}>设置我的第一课</button>
        </section>}
        {tab === 'today' && (
          <TodayView
            plan={dailyPlan}
            stats={stats}
            mapProgress={mapProgress}
            now={now}
            onStart={startSession}
            recentWords={recentWords}
            tracks={learningTrackSnapshots}
          />
        )}
        {tab === 'add' && (
          <AddView
            onRequestLogin={onRequestLogin}
            onAdd={addCustomItem}
            onBulkAdd={bulkAdd}
            onAddWorkVocabulary={addSharedPowerBankVocabulary}
            onEnrich={enrichDraft}
            onLookup={lookupDictionary}
            onSaveDictionary={saveDictionaryEntry}
          />
        )}
        {tab === 'library' && (
          <LibraryView
            onRequestLogin={onRequestLogin}
            items={items}
            onAddToMyVocabulary={addToMyVocabulary}
            onRemoveFromMyVocabulary={removeFromMyVocabulary}
            onToggleStatus={toggleStatus}
            onToggleKnown={toggleKnown}
            onUpdate={updateItem}
            evidenceByItemId={stats.evidenceByItemId}
            onCompleteSenses={completeSenses}
          />
        )}
        {tab === 'voice' && <VoicePractice items={items} accent={settings.speechAccent} onRequestLogin={onRequestLogin} onSaveExpression={saveSpokenExpression} learningGoal={settings.learningGoal} />}
        {tab === 'plans' && <MembershipPlans onExplore={() => { setTab('voice'); onTabChange?.('voice') }} />}
        </Suspense>
      </AppShell>

      {onboardingOpen && <Suspense fallback={settingsFallback}><OnboardingDialog settings={settings} hasLearningHistory={attempts.length > 0 || tracks.some(track => track.reps > 0)} onComplete={completeOnboarding} onClose={() => setOnboardingOpen(false)} /></Suspense>}

      {session && (
        <Suspense fallback={studyFallback}>
        <StudySession
          ensureUsageItem={ensureUsageItem}
          evaluate={evaluateTask}
          initialTasks={session.plan.tasks}
          items={items}
          key={session.id}
          mode="core"
          sessionId={session.id}
          timeEntries={timeEntries}
          onSaveTime={saveStudyTime}
          onDayChange={() => rebuildSession()}
          canVerifySentence={hasDeepseekApiKey()}
          learningStats={stats}
          onExit={() => {
            setSession(null)
            setTab('today')
            setNow(new Date())
          }}
          onFinish={() => { void refreshData().catch((error) => setSessionError(error instanceof Error ? error.message : '读取学习结果失败。')) }}
          onRate={handleRate}
          onMarkKnown={toggleKnown}
          onRefreshTasks={refreshSessionTasks}
          difficultyLevel={difficulty.level}
          onSpeechAccentChange={(accent) => {
            void saveSettings({ ...settings, speechAccent: accent })
          }}
          resolveHint={resolveHint}
          speechAccent={settings.speechAccent}
          tracks={tracks}
          usableThisWeek={stats.applicationCount}
        />
        </Suspense>
      )}

      {settingsOpen && (
        <Suspense fallback={settingsFallback}>
        <SettingsDialog
          account={account}
          onClearLocal={account || preview ? undefined : async () => { await clearDatabase(); window.location.reload() }}
          onOpenOnboarding={() => { setSettingsOpen(false); if (onRequestLogin) onRequestLogin(); else setOnboardingOpen(true) }}
          onRequestLogin={onRequestLogin ? () => { setSettingsOpen(false); onRequestLogin() } : undefined}
          attemptCount={attempts.length}
          onClose={() => setSettingsOpen(false)}
          onExport={downloadBackup}
          onExportVocabulary={downloadVocabularyPack}
          onImport={restoreBackup}
          onImportVocabulary={restoreVocabularyPack}
          onSave={saveSettings}
          settings={settings}
          vocabularyCount={items.length}
        />
        </Suspense>
      )}
    </>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <span className="loading-mark">L</span>
      <strong>Lomi English · 洛米英语</strong>
      <p>正在准备你的本地记忆库…</p>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="loading-screen error-screen">
      <span className="loading-mark">!</span>
      <strong>本地数据暂时打不开</strong>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry} type="button">重新载入</button>
    </div>
  )
}

async function enrichDraft(expression: string, category: SystemListSlug | 'other', existingDefinition?: string) {
  return enrichWithLlm({ expression, category, existingDefinition })
}

async function downloadVocabularyPack() {
  try {
    const json = await exportVocabularyPackJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `recall-english-vocabulary-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    showToast(error instanceof Error ? `导出词库失败：${error.message}` : '导出词库失败。', 'error')
  }
}

function stripHydration(item: VocabularyItem | Word): Word {
  const {
    listSlugs: _listSlugs,
    category: _category,
    scenarioNote: _scenarioNote,
    ...word
  } = item as VocabularyItem
  return word
}

function uniqueListSlugs(values: ListSlug[]): ListSlug[] {
  return [...new Set(values)]
}

function customItemFromDraft(draft: CustomItemDraft): {
  word: Word
  memberships: WordListItem[]
  item: VocabularyItem
} {
  const now = new Date().toISOString()
  const expression = draft.expression.trim()
  const examples = draft.exampleEn.trim()
    ? [{ en: draft.exampleEn.trim(), zh: draft.exampleZh.trim() }]
    : []
  const id = makeId('custom')
  const scenarioNote = draft.category === 'other' ? draft.scenarioNote?.trim() : undefined
  const listSlugs = draft.category === 'other'
    ? uniqueListSlugs(['my-vocabulary'])
    : uniqueListSlugs([draft.category, 'my-vocabulary'])
  const word: Word = {
    id,
    expression,
    lemma: normalizeLemma(expression),
    senseKey: `${slugify(expression)}-${slugify(draft.zhGloss).slice(0, 28) || Date.now()}`,
    zhGloss: draft.zhGloss.trim(),
    enDefinition: draft.enDefinition.trim(),
    partOfSpeech: draft.partOfSpeech.trim() || 'expression',
    acceptedZhAnswers: uniqueStrings([draft.zhGloss.trim()]),
    acceptedEnVariants: uniqueStrings([expression]),
    examples,
    collocations: uniqueStrings(draft.collocations),
    source: draft.source ?? 'custom',
    priority: 0,
    status: 'active',
    ipaUk: draft.ipaUk,
    ipaUs: draft.ipaUs,
    audioUk: draft.audioUk,
    audioUs: draft.audioUs,
    usagePrompts: buildUsagePrompts(expression, examples),
    createdAt: now,
    updatedAt: now,
  }
  const memberships = listSlugs.map((slug, index) => ({
    id: `membership-${id}-${slug}`,
    wordId: id,
    listId: listIdForSlug(slug),
    priority: 0,
    sortOrder: index,
    subcategory: scenarioNote,
  }))
  return {
    word,
    memberships,
    item: {
      ...word,
      listSlugs,
      category: draft.category === 'other' ? 'my-vocabulary' : draft.category,
      scenarioNote,
    },
  }
}

function buildUsagePrompts(expression: string, examples: VocabularyItem['examples']) {
  const example = examples.find((candidate) => normalizeText(candidate.en).includes(normalizeText(expression)))
  if (!example) return []
  const blanked = example.en.replace(new RegExp(escapeRegExp(expression), 'i'), '_____')
  return [
    {
      id: `${slugify(expression)}-cloze`,
      type: 'cloze' as const,
      prompt: blanked,
      answer: expression,
      modelAnswer: example.en,
      checkpoints: [expression],
    },
    {
      id: `${slugify(expression)}-sentence`,
      type: 'sentence' as const,
      prompt: `想一个你会真实使用 “${expression}” 的场景，并写出完整句子。`,
      modelAnswer: example.en,
      checkpoints: [expression],
    },
  ]
}

function normalizeText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
}

function slugify(value: string) {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
}

function makeId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

export default App
