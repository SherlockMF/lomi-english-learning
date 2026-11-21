import { Rating, State, fsrs, type CardInput, type Grade } from 'ts-fsrs'
import type {
  LearningTrack,
  ReviewAttempt,
  ReviewRating,
  SessionTask,
  StudyTimeEntry,
  TrackType,
  UserSettings,
  VocabularyItem,
  Word,
} from '../domain/types'
import { isExplicitFailure, isValidRecallSuccess } from './learningEvidence'
import { activeMsForDate, introducedItemIdsToday, localDateKey } from './learningStats'
import { VOCABULARY_LEVELS, SYSTEM_LIST_ORDER, type SystemListSlug, type VocabularyLevel } from '../domain/types'
import { getStudyDifficulty, getVocabularyDifficulty } from './studyDifficulty'
import { recallContext } from './presentation'
import { expressionKey } from './text'

export type SessionMode = 'core' | 'extension'
export type SchedulerDate = Date | string | number

export const CORE_TASK_MINUTES = 0.75
export const USAGE_TASK_MINUTES = 2
const CATEGORY_ORDER = SYSTEM_LIST_ORDER
const CORE_TRACK_TYPES: readonly TrackType[] = ['receptive', 'productive']

type MixedCategory = SystemListSlug

interface QueueCandidate {
  task: SessionTask
  phase: number
  dueAt: number
  priority: number
  minutes: number
}

function validDate(value: SchedulerDate | undefined, fallback: Date) {
  if (value === undefined) return new Date(fallback)
  const parsed = value instanceof Date ? new Date(value) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed
}

function dateValue(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? fallback : parsed
}

function trackId(itemId: string, type: TrackType) {
  return `${itemId}:${type}`
}

function initialTrack(itemId: string, type: TrackType, now: Date, unlocked: boolean): LearningTrack {
  return {
    id: trackId(itemId, type),
    itemId,
    type,
    due: now.toISOString(),
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: State.New,
    unlocked,
  }
}

/** Creates the two recall tracks for every item and an optional, initially locked usage track. */
export function createInitialTracks(items: Array<Pick<Word, 'id' | 'usagePrompts'>>, now: SchedulerDate = new Date()) {
  const reviewedAt = validDate(now, new Date())
  return items.flatMap((item) => {
    const tracks = [
      initialTrack(item.id, 'receptive', reviewedAt, true),
      initialTrack(item.id, 'productive', reviewedAt, true),
    ]
    if (item.usagePrompts.length > 0) {
      tracks.push(initialTrack(item.id, 'usage', reviewedAt, false))
    }
    return tracks
  })
}

/** Existing unlocked tracks retain historical eligibility; new unlocks require answer evidence. */
export function canUnlockUsage(
  itemId: string,
  tracks: LearningTrack[],
  attempts?: ReviewAttempt[],
  now: SchedulerDate = new Date(),
) {
  if (attempts !== undefined) {
    const nowMs = validDate(now, new Date()).getTime()
    const history = attempts.filter((attempt) => attempt.itemId === itemId
      && dateValue(attempt.reviewedAt, Number.POSITIVE_INFINITY) <= nowMs)
      .sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt))
    const states = CORE_TRACK_TYPES.map((type) => {
      let success = false
      let unresolvedFailure = false
      for (const attempt of history) {
        if (attempt.trackType !== type) continue
        if (isExplicitFailure(attempt)) { success = false; unresolvedFailure = true }
        else if (isValidRecallSuccess(attempt)) { success = true; unresolvedFailure = false }
      }
      return { success, unresolvedFailure }
    })
    return states.every((state) => state.success)
      || (Boolean(tracks.find((track) => track.itemId === itemId && track.type === 'usage')?.unlocked)
        && states.every((state) => !state.unresolvedFailure))
  }
  return CORE_TRACK_TYPES.every((type) => {
    const track = tracks.find((candidate) => candidate.itemId === itemId && candidate.type === type)
    return Boolean(track?.firstGoodAt || track?.lastGoodAt)
  })
}

/**
 * Unlocks newly eligible usage tracks and re-locks usage when core mastery is lost.
 * Newly unlocked tracks become due immediately.
 */
export function unlockEligibleUsageTracks(
  tracks: LearningTrack[],
  now: SchedulerDate = new Date(),
  attempts?: ReviewAttempt[],
) {
  const unlockedAt = validDate(now, new Date())
  const nowValue = unlockedAt.getTime()
  const tracksByItem = new Map<string, LearningTrack[]>()
  const attemptsByItem = new Map<string, ReviewAttempt[]>()
  for (const track of tracks) {
    const group = tracksByItem.get(track.itemId)
    if (group) group.push(track)
    else tracksByItem.set(track.itemId, [track])
  }
  for (const attempt of attempts ?? []) {
    const group = attemptsByItem.get(attempt.itemId)
    if (group) group.push(attempt)
    else attemptsByItem.set(attempt.itemId, [attempt])
  }

  return tracks.map((track) => {
    if (track.type !== 'usage') return track
    const eligible = canUnlockUsage(track.itemId, tracksByItem.get(track.itemId) ?? [],
      attempts === undefined ? undefined : attemptsByItem.get(track.itemId) ?? [], unlockedAt)
    if (eligible) {
      if (track.unlocked) return track
      const currentDue = dateValue(track.due, nowValue)
      return {
        ...track,
        unlocked: true,
        due: new Date(Math.min(currentDue, nowValue)).toISOString(),
      }
    }
    if (!track.unlocked) return track
    return { ...track, unlocked: false }
  })
}

function activeItemMap(items: VocabularyItem[]) {
  return new Map(items.filter((item) => item.status === 'active' && !item.knownAt).map((item) => [item.id, item]))
}

function isCoreTrack(track: LearningTrack) {
  return track.type === 'receptive' || track.type === 'productive'
}

function isFreshItem(itemId: string, tracks: LearningTrack[], attemptedItems: Set<string>) {
  if (attemptedItems.has(itemId)) return false
  const coreTracks = tracks.filter((track) => track.itemId === itemId && isCoreTrack(track))
  return coreTracks.length === 2 && coreTracks.every(
    (track) => track.reps === 0 && track.state === State.New,
  )
}

function compareItems(left: VocabularyItem, right: VocabularyItem) {
  if (left.priority !== right.priority) return left.priority - right.priority
  if (left.source !== right.source) return left.source === 'custom' ? -1 : 1
  const createdDifference = dateValue(left.createdAt, 0) - dateValue(right.createdAt, 0)
  return createdDifference || left.id.localeCompare(right.id)
}

const ORDINARY_CATEGORY_WEIGHTS: Record<MixedCategory, number> = {
  daily: 4,
  business: 3,
  finance: 2,
  accounting: 1,
  campus: 4,
  housing: 3,
  health: 3,
  money: 3,
  career: 3,
  food: 2,
  travel: 2,
  government: 2,
  emergency: 1,
  shopping: 2,
  social: 2,
  entertainment: 1,
  digital: 2,
  communication: 2,
  cs: 1,
  economics: 1,
  math: 1,
  engineering: 1,
  medicine: 1,
  law: 1,
  psychology: 1,
  marketing: 1,
}

function categoryCounts(items: VocabularyItem[]) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0])) as Record<MixedCategory, number>
  for (const item of items) {
    if (item.category !== 'my-vocabulary' && item.category in counts) {
      counts[item.category as MixedCategory] += 1
    }
  }
  return counts
}

function selectNewItems(
  candidates: VocabularyItem[],
  limit: number,
  priorityLimit: number,
  level: VocabularyLevel,
  initialCounts: Record<MixedCategory, number> = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0])) as Record<MixedCategory, number>,
  activeCategories: readonly SystemListSlug[] = CATEGORY_ORDER,
) {
  if (limit <= 0) return []
  const isActive = (item: VocabularyItem) => item.listSlugs.includes('my-vocabulary') || activeCategories.includes(item.category as SystemListSlug)
  const distance = (item: VocabularyItem) => Math.abs(VOCABULARY_LEVELS.indexOf(getVocabularyDifficulty(item).level) - VOCABULARY_LEVELS.indexOf(level))
  const sorted = candidates.filter((item) => !item.listSlugs.includes('my-vocabulary') && isActive(item))
    .sort((left, right) => distance(left) - distance(right) || compareItems(left, right))
  const personal = sorted.filter((item) => item.category === 'my-vocabulary')
  const selected = candidates.filter((item) => item.listSlugs.includes('my-vocabulary'))
    .sort((left, right) => left.expression.localeCompare(right.expression) || left.id.localeCompare(right.id))
    .slice(0, Math.min(limit, Math.max(priorityLimit, limit - sorted.length)))
  if (selected.length >= limit) return selected

  const pools = Object.fromEntries(
    CATEGORY_ORDER.map((category) => [
      category,
      sorted.filter((item) => item.category === category),
    ]),
  ) as Record<MixedCategory, VocabularyItem[]>
  const counts = { ...initialCounts }
  const weights = ORDINARY_CATEGORY_WEIGHTS

  while (selected.length < limit) {
    const nearest = Math.min(...CATEGORY_ORDER.map((category) => pools[category][0] ? distance(pools[category][0]) : Infinity), personal[0] ? distance(personal[0]) : Infinity)
    if (personal[0] && distance(personal[0]) === nearest) { selected.push(personal.shift()!); continue }
    const available = CATEGORY_ORDER.filter((category) => pools[category].length > 0 && distance(pools[category][0]) === nearest)
    if (available.length === 0) break
    const weighted = available.filter((category) => weights[category] > 0)
    const category = (weighted.length > 0 ? weighted : available).reduce((best, current) => {
      if (weights[best] <= 0) return current
      if (weights[current] <= 0) return best
      const bestScore = (counts[best] + 1) / weights[best]
      const currentScore = (counts[current] + 1) / weights[current]
      return currentScore < bestScore ? current : best
    })
    selected.push(pools[category].shift()!)
    counts[category] += 1
  }
  return selected
}

function compareCandidates(left: QueueCandidate, right: QueueCandidate) {
  if (left.phase !== right.phase) return left.phase - right.phase
  if (left.dueAt !== right.dueAt) return left.dueAt - right.dueAt
  if (left.priority !== right.priority) return left.priority - right.priority
  if (left.task.trackType !== right.task.trackType) {
    return CORE_TRACK_TYPES.indexOf(left.task.trackType) - CORE_TRACK_TYPES.indexOf(right.task.trackType)
  }
  return left.task.trackId.localeCompare(right.task.trackId)
}

/** Greedily preserves priority while avoiding adjacent tasks for the same vocabulary item. */
function separateItems(candidates: QueueCandidate[]) {
  const remaining = [...candidates].sort(compareCandidates)
  const ordered: QueueCandidate[] = []
  while (remaining.length > 0) {
    const previousItem = ordered.at(-1)?.task.itemId
    const currentPhase = remaining[0].phase
    let index = remaining.findIndex(
      (candidate) => candidate.phase === currentPhase && candidate.task.itemId !== previousItem,
    )
    if (index < 0) index = 0
    ordered.push(remaining.splice(index, 1)[0])
  }
  return ordered
}

function trackCandidate(
  track: LearningTrack,
  item: VocabularyItem,
  phase: number,
  mode: SessionMode,
  nowValue: number,
): QueueCandidate {
  const promptIndex = track.type === 'usage' && item.usagePrompts.length > 0
    ? track.reps % item.usagePrompts.length
    : undefined
  return {
    task: {
      id: `${mode}:${track.id}${promptIndex === undefined ? '' : `:${promptIndex}`}`,
      itemId: item.id,
      trackId: track.id,
      trackType: track.type,
      isNew: track.reps === 0 || track.state === State.New,
      promptIndex,
    },
    phase,
    dueAt: dateValue(track.due, nowValue),
    priority: item.priority,
    minutes: track.type === 'usage' ? USAGE_TASK_MINUTES : CORE_TASK_MINUTES,
  }
}

function newItemCandidates(
  selectedItems: VocabularyItem[],
  tracks: LearningTrack[],
  phase: number,
  mode: SessionMode,
  nowValue: number,
) {
  let ordinaryIndex = 0
  const phaseByItem = new Map(selectedItems.map((item) => [item.id, item.listSlugs.includes('my-vocabulary') ? phase : phase + 1 + Math.floor(ordinaryIndex++ / 3)]))
  return selectedItems.flatMap((item, index) => CORE_TRACK_TYPES.map((type) => {
    const track = tracks.find(
      (candidate) => candidate.itemId === item.id && candidate.type === type && candidate.unlocked,
    )
    if (!track) return undefined
    return {
      ...trackCandidate(track, item, phaseByItem.get(item.id)!, mode, nowValue),
      dueAt: nowValue,
      priority: index + CORE_TRACK_TYPES.indexOf(type) * selectedItems.length,
    }
  }).filter((candidate): candidate is QueueCandidate => Boolean(candidate)))
}

export interface DailyPlanInput {
  settings: UserSettings
  items: VocabularyItem[]
  tracks: LearningTrack[]
  attempts: ReviewAttempt[]
  timeEntries: StudyTimeEntry[]
  now: SchedulerDate
  /** Total new expressions allowed today for an optional extra round. */
  newItemTarget?: number
  /** Legacy budget metadata; no longer limits the learning queue. */
  additionalMinutes?: number
}

export interface DailyPlan {
  tasks: SessionTask[]
  localDate: string
  dailyMinutes: number
  usedMs: number
  remainingMs: number
  estimatedMinutes: number
  newItemCount: number
  reviewItemCount: number
  reviewTaskCount: number
  usageTaskCount: number
  totalTasks: number
  introducedToday: number
  remainingNewItems: number
  overflowDueCount: number
  reasons: string[]
}

/** The daily count is fixed; the legacy function signature is retained for callers. */
export function getAdaptiveNewItemTarget(
  settings: UserSettings,
  _items: VocabularyItem[],
  _tracks: LearningTrack[],
  _attempts: ReviewAttempt[],
  _now: SchedulerDate = new Date(),
) {
  return Math.min(100, Math.max(0, Math.floor(settings.newItemsPerDay)))
}

/** A single projection for both Today and session start, based only on saved facts. */
export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  const { settings, items, attempts, timeEntries } = input
  const now = validDate(input.now, new Date())
  const nowValue = now.getTime()
  const localDate = localDateKey(now)
  const dailyMinutes = Math.max(0, settings.dailyMinutes ?? settings.coreMinutes ?? 15)
  const usedMs = activeMsForDate(timeEntries, localDate)
  const remainingMs = input.additionalMinutes !== undefined && input.additionalMinutes > 0
    ? input.additionalMinutes * 60_000
    : Math.max(0, dailyMinutes * 60_000 - usedMs)
  const introducedIds = introducedItemIdsToday(attempts, now)
  const introduced = introducedIds.size
  const dailyTarget = input.newItemTarget ?? getAdaptiveNewItemTarget(settings, items, input.tracks, attempts, now)
  const remainingNewItems = Math.max(0, dailyTarget - introduced)
  const tracks = unlockEligibleUsageTracks(input.tracks, now, attempts)
  const activeItems = activeItemMap(items)
  const tracksByItem = new Map<string, LearningTrack[]>()
  for (const track of tracks) {
    const group = tracksByItem.get(track.itemId)
    if (group) group.push(track)
    else tracksByItem.set(track.itemId, [track])
  }
  const validAttempts = attempts.filter((attempt) => dateValue(attempt.reviewedAt, Number.POSITIVE_INFINITY) <= nowValue)
  const attemptedItems = new Set(validAttempts.map((attempt) => attempt.itemId))
  const attemptedDirections = new Set(validAttempts.map((attempt) => `${attempt.itemId}:${attempt.trackType}`))
  const freshItems = [...activeItems.values()].filter(
    (item) => isFreshItem(item.id, tracksByItem.get(item.id) ?? [], attemptedItems),
  )
  const freshIds = new Set(freshItems.map((item) => item.id))
  const senseCounts = new Map<string, number>()
  for (const item of items) {
    const key = expressionKey(item.expression)
    senseCounts.set(key, (senseCounts.get(key) ?? 0) + 1)
  }
  const eligibleTracks = tracks.filter((track) => {
    const item = activeItems.get(track.itemId)
    return track.type !== 'receptive' || !item || (senseCounts.get(expressionKey(item.expression)) ?? 0) < 2
      || Boolean(recallContext(item))
  })
  const due = eligibleTracks.filter((track) => {
    if (!activeItems.has(track.itemId) || !track.unlocked || freshIds.has(track.itemId)) return false
    if (track.type === 'usage' && activeItems.get(track.itemId)!.usagePrompts.length === 0) return false
    const unfinishedDirection = isCoreTrack(track) && track.reps === 0
      && !attemptedDirections.has(`${track.itemId}:${track.type}`)
    return unfinishedDirection || dateValue(track.due, Number.NEGATIVE_INFINITY) <= nowValue
  }).map((track) => trackCandidate(track, activeItems.get(track.itemId)!, 0, 'core', nowValue))
  const firstAttempts = new Map<string, ReviewAttempt>()
  for (const attempt of validAttempts) {
    const previous = firstAttempts.get(attempt.itemId)
    if (!previous || Date.parse(attempt.reviewedAt) < Date.parse(previous.reviewedAt)) firstAttempts.set(attempt.itemId, attempt)
  }
  const priorityIds = new Set(items.filter((item) => item.listSlugs.includes('my-vocabulary')).map((item) => item.id))
  // Preserve the quota spent at first introduction even if the list membership changes later.
  const wasPriority = (id: string) => firstAttempts.get(id)?.wasPriorityStudy ?? priorityIds.has(id)
  const introducedPriority = [...introducedIds].filter(wasPriority).length
  const priorityTarget = Math.round(dailyTarget * 0.8)
  const remainingPriority = Math.max(0, priorityTarget - introducedPriority)
  const difficulty = getStudyDifficulty(settings, items, validAttempts, now)
  // Carry category counts across days; each ordinary word spends one slot at first introduction.
  const ordinaryHistory = items.filter((item) => firstAttempts.has(item.id) && !wasPriority(item.id))
  const newItems = selectNewItems(
    freshItems,
    remainingNewItems,
    remainingPriority,
    difficulty.level,
    categoryCounts(ordinaryHistory),
    settings.activeCategories ?? CATEGORY_ORDER,
  )
  const newCandidates = newItemCandidates(newItems, eligibleTracks, 1, 'core', nowValue)
  const selected = [...separateItems(due), ...separateItems(newCandidates)]
  const newIds = new Set(newItems.map((item) => item.id))
  const tasks = selected.map((candidate) => ({ ...candidate.task, isNew: newIds.has(candidate.task.itemId) }))
  const estimatedMinutes = selected.reduce((sum, candidate) => sum + candidate.minutes, 0)
  const reasons: string[] = []
  reasons.push(`每日新表达 ${dailyTarget} 个：优先学习约 80%（${priorityTarget} 个），其他词库约 20%（${dailyTarget - priorityTarget} 个）；一方不足由另一方补齐。普通词跨天累计，在已激活的 ${(settings.activeCategories ?? CATEGORY_ORDER).length} 类场景中按权重选取。`)
  reasons.push(`普通新词优先安排 ${difficulty.level}，同级不足时补充相邻等级。${settings.adaptiveDifficulty === false ? '自动调整已关闭。' : `自动调整已开启：连续轻松 ${difficulty.easyStreak}/3，连续困难 ${difficulty.hardStreak}/2；累计调整 ${difficulty.changes} 次。`}`)
  if (remainingNewItems === 0) reasons.push(settings.newItemsPerDay === 0
    ? '今日新表达上限为 0，只安排已学内容。' : '今日新表达额度已用完；其他方向与重试不重复计新表达。')
  if (newItems.length < remainingNewItems) reasons.push('可学的新表达不足，按现有内容安排，不为凑足数量重复出题。')
  if (tasks.length === 0 && remainingNewItems === 0) reasons.push('当前没有到期或未完成的练习。')
  return {
    tasks, localDate, dailyMinutes, usedMs, remainingMs, estimatedMinutes,
    newItemCount: newItems.length,
    reviewItemCount: new Set(tasks.filter((task) => !task.isNew).map((task) => task.itemId)).size,
    reviewTaskCount: tasks.filter((task) => !task.isNew && task.trackType !== 'usage').length,
    usageTaskCount: tasks.filter((task) => task.trackType === 'usage').length,
    totalTasks: tasks.length, introducedToday: introduced, remainingNewItems,
    overflowDueCount: 0, reasons,
  }
}

const FSRS_RATINGS: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
}

/** Applies one UI rating to a persisted LearningTrack through ts-fsrs. */
export function scheduleReview(
  track: LearningTrack,
  rating: ReviewRating,
  now: SchedulerDate = new Date(),
  desiredRetention = 0.9,
): LearningTrack {
  const reviewedAt = validDate(now, new Date())
  const state = Object.values(State).includes(track.state) ? track.state as State : State.New
  const card: CardInput = {
    due: validDate(track.due, reviewedAt),
    stability: state === State.New ? 0 : Math.max(0.01, track.stability),
    difficulty: state === State.New ? 0 : Math.min(10, Math.max(1, track.difficulty)),
    elapsed_days: Math.max(0, track.elapsedDays),
    scheduled_days: Math.max(0, track.scheduledDays),
    learning_steps: 0,
    reps: Math.max(0, track.reps),
    lapses: Math.max(0, track.lapses),
    state,
    last_review: track.lastReview ? validDate(track.lastReview, reviewedAt) : undefined,
  }
  const scheduler = fsrs({
    request_retention: Math.min(0.97, Math.max(0.7, desiredRetention)),
    enable_fuzz: false,
    enable_short_term: false,
  })
  const result = scheduler.next(card, reviewedAt, FSRS_RATINGS[rating]).card
  const reviewedIso = reviewedAt.toISOString()
  const wasGood = rating === 'good'
  // These legacy timestamps remain for compatibility; answer evidence determines displayed ability.
  const demoteMastery = rating === 'again'

  return {
    ...track,
    due: result.due.toISOString(),
    stability: result.stability,
    difficulty: result.difficulty,
    elapsedDays: result.elapsed_days,
    scheduledDays: result.scheduled_days,
    reps: result.reps,
    lapses: result.lapses,
    state: result.state,
    lastReview: result.last_review?.toISOString() ?? reviewedIso,
    firstGoodAt: wasGood
      ? track.firstGoodAt ?? reviewedIso
      : demoteMastery
        ? undefined
        : track.firstGoodAt,
    lastGoodAt: wasGood
      ? reviewedIso
      : demoteMastery
        ? undefined
        : track.lastGoodAt,
  }
}

/** Reinserts a failed task after other material without mutating the pending queue. */
export function requeueFailedTask(
  pending: SessionTask[],
  failed: SessionTask,
  minimumGap = 2,
) {
  const retryCount = (failed.retryCount ?? 0) + 1
  const retry: SessionTask = {
    ...failed,
    id: `${failed.id}:retry:${retryCount}`,
    retryCount,
  }
  const result = [...pending]
  const start = Math.min(result.length, Math.max(0, Math.floor(minimumGap)))
  let insertionIndex = -1
  for (let index = start; index <= result.length; index += 1) {
    const before = result[index - 1]
    const after = result[index]
    if (before?.itemId !== failed.itemId && after?.itemId !== failed.itemId) {
      insertionIndex = index
      break
    }
  }
  result.splice(insertionIndex < 0 ? result.length : insertionIndex, 0, retry)
  return result
}
