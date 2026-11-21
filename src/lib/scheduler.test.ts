import { State } from 'ts-fsrs'
import { DEFAULT_SETTINGS } from '../domain/types'
import type {
  LearningTrack,
  ReviewAttempt,
  ListSlug,
  SystemListSlug,
  TrackType,
  UserSettings,
  VocabularyItem,
} from '../domain/types'
import {
  buildDailyPlan,
  canUnlockUsage,
  createInitialTracks,
  getAdaptiveNewItemTarget,
  requeueFailedTask,
  scheduleReview,
  unlockEligibleUsageTracks,
} from './scheduler'

const NOW = new Date('2026-08-10T00:00:00.000Z')

function makeItem(
  id: string,
  category: ListSlug = 'daily',
  overrides: Partial<VocabularyItem> = {},
): VocabularyItem {
  return {
    id,
    expression: id,
    lemma: id,
    senseKey: `${id}-sense`,
    zhGloss: `${id}-中文`,
    enDefinition: `${id} definition`,
    partOfSpeech: 'noun',
    acceptedZhAnswers: [],
    acceptedEnVariants: [],
    examples: [],
    collocations: [],
    listSlugs: [category],
    category,
    source: 'seed',
    priority: 1,
    status: 'active',
    usagePrompts: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeTrack(
  itemId: string,
  type: TrackType,
  overrides: Partial<LearningTrack> = {},
): LearningTrack {
  return {
    id: `${itemId}:${type}`,
    itemId,
    type,
    due: NOW.toISOString(),
    stability: 4,
    difficulty: 5,
    elapsedDays: 2,
    scheduledDays: 2,
    reps: 2,
    lapses: 0,
    state: State.Review,
    lastReview: '2026-08-08T00:00:00.000Z',
    unlocked: true,
    ...overrides,
  }
}

function makeAttempt(
  index: number,
  itemId: string,
  overrides: Partial<ReviewAttempt> = {},
): ReviewAttempt {
  return {
    id: `attempt-${index}`,
    trackId: `${itemId}:productive`,
    itemId,
    trackType: 'productive',
    promptType: 'productive',
    answer: itemId,
    rating: 'good',
    hintLevel: 0,
    responseMs: 3_000,
    reviewedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
    ...overrides,
  }
}

function settings(overrides: Partial<Omit<UserSettings, 'contentMix' | 'activeCategories'>> & {
  contentMix?: Partial<Record<SystemListSlug, number>>
  activeCategories?: SystemListSlug[]
} = {}): UserSettings {
  const { contentMix, activeCategories, ...rest } = overrides
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    ...(contentMix ? { contentMix: { ...DEFAULT_SETTINGS.contentMix, ...contentMix } } : {}),
    ...(activeCategories ? { activeCategories } : {}),
  }
}

describe('createInitialTracks and usage unlocking', () => {
  it('withholds ambiguous receptive questions without English context and schedules them after context is supplied', () => {
    const first = makeItem('interest-curiosity', 'daily', { expression: 'interest', zhGloss: '兴趣', enDefinition: '', examples: [], collocations: [] })
    const second = makeItem('interest-benefit', 'daily', { expression: 'interest', zhGloss: '利益', enDefinition: '', examples: [], collocations: [] })
    const items = [first, second]
    const tracks = createInitialTracks(items, NOW)
    const input = { settings: settings(), items, tracks, attempts: [], timeEntries: [], now: NOW }
    const plan = buildDailyPlan(input)
    expect(plan.tasks.some((task) => task.trackType === 'receptive')).toBe(false)
    expect(plan.tasks.some((task) => task.trackType === 'productive')).toBe(true)
    const clarified = buildDailyPlan({ ...input, items: [{ ...first, enDefinition: 'a desire to learn about something' }, second] })
    expect(clarified.tasks.some((task) => task.itemId === first.id && task.trackType === 'receptive')).toBe(true)
    expect(clarified.tasks.some((task) => task.itemId === second.id && task.trackType === 'receptive')).toBe(false)
  })
  it('creates two core tracks and only creates a locked usage track when prompts exist', () => {
    const plain = makeItem('plain')
    const usable = makeItem('usable', 'business', {
      usagePrompts: [{
        id: 'prompt-1',
        type: 'cloze',
        prompt: 'We need to ___ today.',
        answer: 'break even',
        modelAnswer: 'We need to break even today.',
        checkpoints: ['break even'],
      }],
    })

    const tracks = createInitialTracks([plain, usable], NOW)

    expect(tracks).toHaveLength(5)
    expect(tracks.filter((track) => track.itemId === 'plain').map((track) => track.type))
      .toEqual(['receptive', 'productive'])
    expect(tracks.find((track) => track.id === 'usable:usage')).toMatchObject({
      state: State.New,
      reps: 0,
      unlocked: false,
      due: NOW.toISOString(),
    })
  })

  it('withholds an ambiguous due direction even when the other sense is paused', () => {
    const first = makeItem('interest-curiosity', 'daily', { expression: 'interest', enDefinition: '' })
    const second = makeItem('interest-benefit', 'daily', { expression: 'interest', status: 'paused' })
    const tracks = [makeTrack(first.id, 'receptive'), makeTrack(first.id, 'productive')]
    const input = { settings: settings({ newItemsPerDay: 0 }), items: [first, second], tracks,
      attempts: [], timeEntries: [], now: NOW }
    expect(buildDailyPlan(input).tasks.map((task) => task.trackType)).toEqual(['productive'])
    expect(buildDailyPlan({ ...input, items: [{ ...first, examples: [{ en: 'She has an interest in art.', zh: '' }] }, second] })
      .tasks.some((task) => task.trackType === 'receptive')).toBe(true)
  })

  it('unlocks usage only after both recall directions have a good review', () => {
    const item = makeItem('usable', 'daily', {
      usagePrompts: [{
        id: 'prompt',
        type: 'sentence',
        prompt: 'Write a sentence.',
        modelAnswer: 'This is usable.',
        checkpoints: ['usable'],
      }],
    })
    const tracks = createInitialTracks([item], '2026-08-20T00:00:00.000Z').map((track) => (
      track.type === 'receptive' || track.type === 'productive'
        ? { ...track, firstGoodAt: '2026-08-09T00:00:00.000Z' }
        : track
    ))

    expect(canUnlockUsage(item.id, tracks)).toBe(true)
    const unlocked = unlockEligibleUsageTracks(tracks, NOW)
    expect(unlocked.find((track) => track.type === 'usage')).toMatchObject({
      unlocked: true,
      due: NOW.toISOString(),
    })
    expect(tracks.find((track) => track.type === 'usage')?.unlocked).toBe(false)
  })
})

describe('buildDailyPlan task queue', () => {
  it('puts overdue core work first, separates the same item, and mixes new categories', () => {
    const items = [
      makeItem('due-a'),
      makeItem('due-b'),
      makeItem('new-daily', 'daily'),
      makeItem('new-finance', 'finance'),
      makeItem('new-business', 'business'),
      makeItem('paused', 'daily', { status: 'paused', priority: 99 }),
    ]
    const freshTracks = createInitialTracks(items.slice(2), NOW)
    const tracks = [
      makeTrack('due-a', 'receptive', { due: '2026-08-07T00:00:00.000Z' }),
      makeTrack('due-a', 'productive', { due: '2026-08-09T00:00:00.000Z' }),
      makeTrack('due-b', 'receptive', { due: '2026-08-08T00:00:00.000Z' }),
      makeTrack('due-b', 'productive', { due: '2026-08-12T00:00:00.000Z' }),
      ...freshTracks,
    ]
    const queue = buildDailyPlan({ settings: settings({
        coreMinutes: 10,
        newItemsPerDay: 3,
        contentMix: { daily: 0.25, business: 0.25, finance: 0.25, accounting: 0.25 },
      }), items: items, tracks: tracks, attempts: [], timeEntries: [], now: NOW }).tasks

    expect(queue.slice(0, 3).map((task) => task.trackId)).toEqual([
      'due-a:receptive',
      'due-b:receptive',
      'due-a:productive',
    ])
    expect(queue.slice(0, 3).every((task) => !task.isNew)).toBe(true)
    expect(queue.some((task) => task.itemId === 'paused')).toBe(false)
    expect(queue.slice(3).filter((task) => task.isNew)).toHaveLength(6)
    expect(new Set(queue.slice(3).map((task) => task.itemId))).toEqual(new Set([
      'new-daily',
      'new-finance',
      'new-business',
    ]))
    for (let index = 1; index < queue.length; index += 1) {
      expect(queue[index].itemId).not.toBe(queue[index - 1].itemId)
    }
  })

  it('uses the same daily budget and hard new-item limit for both kinds of practice', () => {
    const usageItem = makeItem('usage-item', 'daily', {
      usagePrompts: [{
        id: 'usage-prompt',
        type: 'cloze',
        prompt: 'Use ___.',
        answer: 'usage-item',
        modelAnswer: 'Use usage-item.',
        checkpoints: ['usage-item'],
      }],
    })
    const dueA = makeItem('due-a')
    const dueB = makeItem('due-b')
    const freshItems = [
      makeItem('extra-d1', 'daily'),
      makeItem('extra-d2', 'daily'),
      makeItem('extra-f1', 'finance'),
      makeItem('extra-b1', 'business'),
    ]
    const items = [usageItem, dueA, dueB, ...freshItems]
    const tracks = [
      makeTrack('usage-item', 'receptive', { due: '2026-08-20T00:00:00.000Z', firstGoodAt: '2026-08-01T00:00:00.000Z' }),
      makeTrack('usage-item', 'productive', { due: '2026-08-20T00:00:00.000Z', firstGoodAt: '2026-08-02T00:00:00.000Z' }),
      makeTrack('usage-item', 'usage', { due: '2026-08-09T00:00:00.000Z' }),
      makeTrack('due-a', 'receptive', { due: '2026-08-07T00:00:00.000Z' }),
      makeTrack('due-a', 'productive', { due: '2026-08-20T00:00:00.000Z' }),
      makeTrack('due-b', 'receptive', { due: '2026-08-08T00:00:00.000Z' }),
      makeTrack('due-b', 'productive', { due: '2026-08-20T00:00:00.000Z' }),
      ...createInitialTracks(freshItems, NOW),
    ]

    const queue = buildDailyPlan({ settings: settings({ dailyMinutes: 10, coreMinutes: 0.75, extensionMinutes: 10, newItemsPerDay: 2 }), items: items, tracks: tracks, attempts: [], timeEntries: [], now: NOW }).tasks

    expect(queue.slice(0, 3).map((task) => task.itemId)).toEqual(['due-a', 'due-b', 'usage-item'])
    const extraTasks = queue.filter((task) => task.isNew)
    expect(new Set(extraTasks.map((task) => task.itemId)).size).toBe(2)
    expect(extraTasks).toHaveLength(4)
    expect(queue).toEqual(buildDailyPlan({ settings: settings({ dailyMinutes: 10, newItemsPerDay: 2 }), items: items, tracks: tracks, attempts: [], timeEntries: [], now: NOW }).tasks)
  })

  it('uses lower numeric priority first within a content category', () => {
    const first = makeItem('priority-one', 'daily', { priority: 1 })
    const later = makeItem('priority-two', 'daily', { priority: 2 })
    const items = [later, first]
    const queue = buildDailyPlan({ settings: settings({ coreMinutes: 3, newItemsPerDay: 1, contentMix: { daily: 1, business: 0, finance: 0, accounting: 0 } }), items: items, tracks: createInitialTracks(items, NOW), attempts: [], timeEntries: [], now: NOW }).tasks

    expect(new Set(queue.map((task) => task.itemId))).toEqual(new Set(['priority-one']))
  })

  it('counts newly introduced items by local calendar day, not UTC day', () => {
    const now = new Date(2026, 7, 13, 10, 0, 0)
    const earlierSameLocalDay = new Date(2026, 7, 13, 1, 0, 0)
    const items = [
      makeItem('already-started', 'daily', { priority: 1 }),
      makeItem('still-fresh-a', 'daily', { priority: 2 }),
      makeItem('still-fresh-b', 'daily', { priority: 3 }),
    ]
    const tracks = createInitialTracks(items, now)
    const attempts = [makeAttempt(0, 'already-started', {
      reviewedAt: earlierSameLocalDay.toISOString(),
    })]

    const queue = buildDailyPlan({
      settings: settings({
        coreMinutes: 10,
        newItemsPerDay: 2,
        contentMix: { daily: 1, business: 0, finance: 0, accounting: 0 },
      }),
      items,
      tracks,
      attempts,
      timeEntries: [],
      now,
    }).tasks

    const freshQueued = new Set(
      queue
        .filter((task) => task.itemId === 'still-fresh-a' || task.itemId === 'still-fresh-b')
        .map((task) => task.itemId),
    )
    expect(freshQueued).toEqual(new Set(['still-fresh-a']))
  })
})

describe('fixed daily target', () => {
  const item = makeItem('learned')
  const fresh = Array.from({ length: 10 }, (_, index) => makeItem(`fresh-${index}`))
  const allItems = [item, ...fresh]
  const tracks = [
    makeTrack('learned', 'receptive', { due: '2026-08-20T00:00:00.000Z' }),
    makeTrack('learned', 'productive', { due: '2026-08-20T00:00:00.000Z' }),
    ...createInitialTracks(fresh, NOW),
  ]

  it('keeps the configured count for both weak and strong delayed recall', () => {
    const initial = Array.from({ length: 10 }, (_, index) => makeAttempt(index, `word-${index}`, {
      reviewedAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    }))
    const strong = [...initial, ...Array.from({ length: 10 }, (_, index) => makeAttempt(index + 10, `word-${index}`, {
      evidenceVersion: 1, retryCount: 0, evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact',
    }))]
    const weak = strong.map((attempt, index) => index >= 10 && index < 15
      ? { ...attempt, correctness: 'incorrect' as const } : attempt)
    const configured = settings({ coreMinutes: 30, newItemsPerDay: 6 })

    expect(getAdaptiveNewItemTarget(configured, allItems, tracks, weak, NOW)).toBe(6)
    expect(getAdaptiveNewItemTarget(configured, allItems, tracks, strong, NOW)).toBe(6)
  })

  it('keeps the new-word quota when due reviews consume the time budget', () => {
    const dueTracks = [
      makeTrack('learned', 'receptive', { due: '2026-08-09T00:00:00.000Z' }),
      makeTrack('learned', 'productive', { due: '2026-08-09T00:00:00.000Z' }),
      ...createInitialTracks(fresh, NOW),
    ]
    expect(buildDailyPlan({ settings: settings({ dailyMinutes: 1, newItemsPerDay: 6 }),
      items: allItems, tracks: dueTracks, attempts: [], timeEntries: [], now: NOW,
    }).newItemCount).toBe(6)
  })

  it.each([
    { total: 9, correct: 0, baseline: 5, target: 5 },
    { total: 10, correct: 6, baseline: 5, target: 5 },
    { total: 20, correct: 13, baseline: 5, target: 5 },
    { total: 10, correct: 8, baseline: 5, target: 5 },
    { total: 10, correct: 7, baseline: 1, target: 1 },
    { total: 10, correct: 0, baseline: 0, target: 0 },
    { total: 10, correct: 10, baseline: 3.9, target: 3 },
  ])('uses the configured count independently of delayed recall: %j', ({ total, correct, baseline, target }) => {
    const attempts = Array.from({ length: total }, (_, index) => [
      makeAttempt(index, `sample-${index}`, { reviewedAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString() }),
      makeAttempt(index + total, `sample-${index}`, { reviewedAt: NOW.toISOString(),
        evidenceVersion: 1, retryCount: 0, evaluationSource: 'rules',
        correctness: index < correct ? 'correct' : 'incorrect', matchKind: 'exact' }),
    ]).flat()
    expect(getAdaptiveNewItemTarget(settings({ newItemsPerDay: baseline }), allItems, tracks, attempts, NOW)).toBe(target)
  })
})

describe('buildDailyPlan', () => {
  it.each([false, true])('balances two ordinary words per day across five-day cycles, split sessions: %s', (splitSessions) => {
    const categories = ['daily', 'business', 'finance', 'accounting'] as const
    const priority = Array.from({ length: 80 }, (_, i) => makeItem(`p-${i}`, 'daily', {
      listSlugs: ['daily', 'my-vocabulary'], vocabularyLevel: 'B1',
    }))
    const ordinary = categories.flatMap((category) => Array.from({ length: 20 }, (_, i) =>
      makeItem(`${category}-${i}`, category, { vocabularyLevel: 'B1' })))
    const items = [...priority, ...ordinary]
    const tracks = createInitialTracks(items, NOW)
    const attempts: ReviewAttempt[] = []
    const counts = [0, 0, 0, 0]
    for (let day = 0; day < 10; day += 1) {
      const now = new Date(NOW.getTime() + day * 86_400_000)
      let ordinaryToday = 0
      for (let session = 0; session < (splitSessions ? 2 : 1); session += 1) {
        const input = { items, tracks, attempts, settings: settings({ newItemsPerDay: 10, adaptiveDifficulty: false }), timeEntries: [], now }
        const plan = buildDailyPlan(input)
        expect(buildDailyPlan(input).tasks).toEqual(plan.tasks)
        const ids = [...new Set(plan.tasks.filter((task) => task.isNew).map((task) => task.itemId))]
        expect(ids).toHaveLength(session === 0 ? 10 : 1)
        const studied = splitSessions && session === 0 ? ids.slice(0, 9) : ids
        for (const id of studied) {
          const item = items.find((candidate) => candidate.id === id)!
          const wasPriorityStudy = item.listSlugs.includes('my-vocabulary')
          if (!wasPriorityStudy) {
            counts[categories.indexOf(item.category as typeof categories[number])] += 1
            ordinaryToday += 1
          }
          attempts.push(makeAttempt(attempts.length, id, { reviewedAt: now.toISOString(), wasPriorityStudy }))
          // Uneven retries must not consume more category quota.
          if (item.category === 'daily') attempts.push(makeAttempt(attempts.length, id, {
            reviewedAt: now.toISOString(), wasPriorityStudy, retryCount: 1,
          }))
        }
      }
      expect(ordinaryToday).toBe(2)
      if ((day + 1) % 5 === 0) expect(counts).toEqual([4, 3, 2, 1].map((count) => count * (day + 1) / 5))
    }
  })

  it.each([true, false])('preserves daily quotas across sessions and membership changes: %s', (priorityFirst) => {
    const items = [...Array.from({ length: 10 }, (_, i) => makeItem(`p-${i}`, 'finance', { listSlugs: ['finance', 'my-vocabulary'] })),
      ...Array.from({ length: 10 }, (_, i) => makeItem(`o-${i}`))]
    const introduced = priorityFirst ? items.slice(0, 4) : items.slice(10, 11)
    const attempts = introduced.map((item, i) => makeAttempt(i, item.id, { wasPriorityStudy: priorityFirst, reviewedAt: NOW.toISOString() }))
    const changed = items.map((item) => introduced.includes(item) ? { ...item, listSlugs: priorityFirst ? ['finance' as const] : ['my-vocabulary' as const] } : item)
    const plan = buildDailyPlan({ items: changed, tracks: createInitialTracks(changed, NOW), settings: settings({ newItemsPerDay: 5 }), attempts, timeEntries: [], now: NOW })
    const fresh = [...new Set(plan.tasks.filter((task) => task.isNew).map((task) => task.itemId))]
    expect(fresh).toHaveLength(priorityFirst ? 1 : 4)
    expect(fresh.every((id) => id.startsWith(priorityFirst ? 'o-' : 'p-'))).toBe(true)
  })

  it('weights ordinary categories 40/30/20/10 independently of priority categories and legacy settings', () => {
    const priority = Array.from({ length: 80 }, (_, i) => makeItem(`p-${i}`, 'daily', { listSlugs: ['daily', 'my-vocabulary'], vocabularyLevel: 'B1' }))
    const categories = ['daily', 'business', 'finance', 'accounting'] as const
    const ordinary = categories.flatMap((category) => Array.from({ length: 30 }, (_, i) => makeItem(`${category}-${i}`, category, { vocabularyLevel: 'B1' })))
    const items = [...priority, ...ordinary]
    const plan = buildDailyPlan({ items, tracks: createInitialTracks(items, NOW), settings: settings({ newItemsPerDay: 100, contentMix: { daily: 0, business: 0, finance: 0, accounting: 1 } }), attempts: [], timeEntries: [], now: NOW })
    const ids = new Set(plan.tasks.map((task) => task.itemId))
    expect(categories.map((category) => ordinary.filter((item) => item.category === category && ids.has(item.id)).length)).toEqual([8, 6, 4, 2])
  })

  it('balances equally weighted opt-in subjects and excludes them from the default rotation', () => {
    const items = [
      makeItem('cs-1', 'cs', { vocabularyLevel: 'B1' }),
      makeItem('cs-2', 'cs', { vocabularyLevel: 'B1' }),
      makeItem('math-1', 'math', { vocabularyLevel: 'B1' }),
      makeItem('math-2', 'math', { vocabularyLevel: 'B1' }),
    ]
    const input = { items, tracks: createInitialTracks(items, NOW), attempts: [], timeEntries: [], now: NOW }
    const defaultPlan = buildDailyPlan({ ...input, settings: settings({ newItemsPerDay: 2 }) })
    const subjectPlan = buildDailyPlan({ ...input, settings: settings({ newItemsPerDay: 2, activeCategories: ['cs', 'math'] }) })
    expect(defaultPlan.newItemCount).toBe(0)
    expect(new Set(subjectPlan.tasks.map(({ itemId }) => itemId))).toEqual(new Set(['cs-1', 'math-1']))
  })

  it('uses the chosen order for category shares and recognizes secondary list memberships', () => {
    const selected = ['math', 'cs', 'daily'] as const
    const items = selected.flatMap(category => Array.from({ length: 8 }, (_, i) =>
      makeItem(`${category}-${i}`, category, { vocabularyLevel: 'B1' })))
    const shared = makeItem('shared', 'finance', { listSlugs: ['finance', 'math'], vocabularyLevel: 'B1', priority: 0 })
    items.push(shared, makeItem('unselected', 'finance', { vocabularyLevel: 'B1', priority: 0 }))
    const input = { items, tracks: createInitialTracks(items, NOW), attempts: [], timeEntries: [], now: NOW }
    const scheduled = (activeCategories: SystemListSlug[]) => new Set(buildDailyPlan({ ...input,
      settings: settings({ newItemsPerDay: 6, activeCategories }) }).tasks.map(task => task.itemId))
    const ranked = scheduled([...selected])
    expect(ranked.has('shared')).toBe(true)
    expect(ranked.has('unselected')).toBe(false)
    expect([...ranked].filter(id => id.startsWith('math') || id === 'shared')).toHaveLength(3)
    expect([...ranked].filter(id => id.startsWith('cs'))).toHaveLength(2)
    expect([...ranked].filter(id => id.startsWith('daily'))).toHaveLength(1)
    expect([...scheduled(['daily', 'cs', 'math'])].filter(id => id.startsWith('daily'))).toHaveLength(3)
  })

  it('allocates from the current priorities after changing the category order', () => {
    const old = Array.from({ length: 10 }, (_, i) => makeItem(`old-math-${i}`, 'math', { status: 'paused' }))
    const fresh = [makeItem('fresh-math', 'math'), makeItem('fresh-daily')]
    const items = [...old, ...fresh]
    const plan = buildDailyPlan({ items, tracks: createInitialTracks(items, NOW), timeEntries: [], now: NOW,
      settings: settings({ newItemsPerDay: 1, activeCategories: ['math', 'daily'], categoryPriorityChangedAt: NOW.toISOString() }),
      attempts: old.map((item, i) => makeAttempt(i, item.id, { reviewedAt: new Date(NOW.getTime() - 86_400_000).toISOString() })),
    })
    expect(new Set(plan.tasks.map(task => task.itemId))).toEqual(new Set(['fresh-math']))
  })

  it.each([0, 1, 2, 3, 5, 7, 10, 20])('uses rounded 80/20 quotas for %i new words', (total) => {
    const items = [...Array.from({ length: 20 }, (_, i) => makeItem(`p-${i}`, 'finance', { listSlugs: ['finance', 'my-vocabulary'] })),
      ...Array.from({ length: 20 }, (_, i) => makeItem(`o-${i}`))]
    const plan = buildDailyPlan({ items, tracks: createInitialTracks(items, NOW), settings: settings({ newItemsPerDay: total }), attempts: [], timeEntries: [], now: NOW })
    const ids = [...new Set(plan.tasks.map((task) => task.itemId))]
    expect(ids).toHaveLength(total)
    expect(ids.filter((id) => id.startsWith('p-'))).toHaveLength(Math.round(total * 0.8))
  })

  it('fills missing ordinary slots from priority words', () => {
    const items = Array.from({ length: 12 }, (_, i) => makeItem(`p-${i}`, 'daily', { listSlugs: ['daily', 'my-vocabulary'] }))
    items.push(makeItem('ordinary'))
    const plan = buildDailyPlan({ items, tracks: createInitialTracks(items, NOW), settings: settings({ newItemsPerDay: 10 }), attempts: [], timeEntries: [], now: NOW })
    expect(plan.newItemCount).toBe(10)
    expect(new Set(plan.tasks.filter((task) => task.itemId.startsWith('p-')).map((task) => task.itemId)).size).toBe(9)
  })

  it.each([{ count: 0, dailyLimit: 6 }, { count: 1, dailyLimit: 3 }, { count: 4, dailyLimit: 7 }, { count: 15, dailyLimit: 10 }])(
    'fills the configured quota with priority words first, then ordinary words: %j', ({ count, dailyLimit }) => {
    const priorityItems = Array.from({ length: count }, (_, index) => makeItem(`priority-${String(index).padStart(2, '0')}`, 'daily', {
      listSlugs: ['daily', 'my-vocabulary'], priority: count - index,
    }))
    const ordinaryItems = Array.from({ length: 15 }, (_, index) => makeItem(`ordinary-${index}`, 'business'))
    // oxlint-disable-next-line no-array-reverse -- ES2022 target; reverse only the copied fixture array.
    const items = [...ordinaryItems, ...[...priorityItems].reverse()]
    const plan = buildDailyPlan({ items, tracks: createInitialTracks(items, NOW),
      settings: settings({ dailyMinutes: 30, newItemsPerDay: dailyLimit,
        contentMix: { daily: 0, business: 1, finance: 0, accounting: 0 } }),
      attempts: [], timeEntries: [], now: NOW })
    const selected = [...new Set(plan.tasks.map((task) => task.itemId))]
    expect(plan.newItemCount).toBe(dailyLimit)
    const priorityCount = Math.min(count, Math.round(dailyLimit * 0.8))
    expect(selected.slice(0, priorityCount)).toEqual(priorityItems.slice(0, priorityCount).map((item) => item.id))
    expect(selected.filter((id) => id.startsWith('ordinary-'))).toHaveLength(dailyLimit - priorityCount)
    const ordinaryStart = plan.tasks.findIndex((task) => task.itemId.startsWith('ordinary-'))
    if (ordinaryStart >= 0) expect(plan.tasks.slice(ordinaryStart).every((task) => task.itemId.startsWith('ordinary-'))).toBe(true)
  })

  it('advances through remaining priority words and fills spare slots with ordinary words', () => {
    const priorityItems = Array.from({ length: 15 }, (_, index) => makeItem(`priority-${String(index).padStart(2, '0')}`, 'finance', {
      listSlugs: ['finance', 'my-vocabulary'],
    }))
    const ordinaryItems = Array.from({ length: 10 }, (_, index) => makeItem(`ordinary-${index}`, 'daily'))
    const items = [...ordinaryItems, ...priorityItems]
    const tracks = createInitialTracks(items, NOW).map((track) => priorityItems.slice(0, 10).some((item) => item.id === track.itemId)
      ? makeTrack(track.itemId, track.type, { due: '2026-08-20T00:00:00.000Z' }) : track)
    const plan = buildDailyPlan({ items, tracks, settings: settings({ dailyMinutes: 30, newItemsPerDay: 10 }),
      attempts: [], timeEntries: [], now: NOW })
    const selected = [...new Set(plan.tasks.map((task) => task.itemId))]
    expect(selected.slice(0, 5)).toEqual(priorityItems.slice(10).map((item) => item.id))
    expect(selected).toHaveLength(10)
    expect(selected.filter((id) => id.startsWith('ordinary-'))).toHaveLength(5)
    const completedTracks = tracks.map((track) => track.itemId.startsWith('priority-')
      ? makeTrack(track.itemId, track.type, { due: '2026-08-20T00:00:00.000Z' }) : track)
    const nextPlan = buildDailyPlan({ items, tracks: completedTracks,
      settings: settings({ dailyMinutes: 30, newItemsPerDay: 10 }), attempts: [], timeEntries: [], now: NOW })
    expect(new Set(nextPlan.tasks.map((task) => task.itemId))).toEqual(new Set(ordinaryItems.map((item) => item.id)))
  })

  it('finishes an introduced priority direction without blocking the remaining daily new-word allowance', () => {
    const items = [makeItem('priority', 'daily', { listSlugs: ['daily', 'my-vocabulary'] }),
      makeItem('ordinary-fresh'), makeItem('ordinary-due')]
    const tracks = [makeTrack('priority', 'receptive', { due: '2026-08-20T00:00:00.000Z' }),
      ...createInitialTracks([items[0]], NOW).filter((track) => track.type === 'productive'),
      ...createInitialTracks([items[1]], NOW), makeTrack('ordinary-due', 'receptive')]
    const input = { items, tracks, settings: settings({ newItemsPerDay: 3 }),
      attempts: [makeAttempt(0, 'priority', { trackType: 'receptive', trackId: 'priority:receptive' })],
      timeEntries: [], now: NOW }
    const plan = buildDailyPlan(input)
    expect(plan.introducedToday).toBe(1)
    expect(plan.remainingNewItems).toBe(2)
    expect(new Set(plan.tasks.map((task) => task.itemId))).toEqual(new Set(['priority', 'ordinary-due', 'ordinary-fresh']))
    expect(plan.tasks.findIndex((task) => task.trackId === 'priority:productive'))
      .toBeLessThan(plan.tasks.findIndex((task) => task.itemId === 'ordinary-fresh'))
    const completed = buildDailyPlan({ ...input,
      tracks: tracks.map((track) => track.id === 'priority:productive'
        ? makeTrack('priority', 'productive', { due: '2026-08-20T00:00:00.000Z' }) : track),
      attempts: [...input.attempts, makeAttempt(1, 'priority')] })
    expect(new Set(completed.tasks.map((task) => task.itemId))).toEqual(new Set(['ordinary-due', 'ordinary-fresh']))
  })

  it('does not block ordinary new words while a priority review is scheduled for a future day', () => {
    const items = [makeItem('priority', 'daily', { listSlugs: ['daily', 'my-vocabulary'] }), makeItem('ordinary')]
    const tracks = [makeTrack('priority', 'receptive', { due: '2026-08-20T00:00:00.000Z' }),
      makeTrack('priority', 'productive', { due: '2026-08-20T00:00:00.000Z' }), ...createInitialTracks([items[1]], NOW)]
    const failed = makeAttempt(0, 'priority', { rating: 'again', reviewedAt: '2026-08-09T00:00:00.000Z' })
    const input = { items, tracks, settings: settings({ newItemsPerDay: 3 }),
      attempts: [failed], timeEntries: [], now: NOW }
    expect(new Set(buildDailyPlan(input).tasks.map((task) => task.itemId))).toEqual(new Set(['ordinary']))
    const retry = makeAttempt(1, 'priority', { rating: 'good', retryCount: 1 })
    expect(new Set(buildDailyPlan({ ...input, attempts: [retry, failed] }).tasks.map((task) => task.itemId)))
      .toEqual(new Set(['ordinary']))
  })

  it('treats unlisted custom words as ordinary and excludes paused priority words', () => {
    const items = [makeItem('custom', 'my-vocabulary', { listSlugs: [], source: 'custom', priority: 0 }),
      makeItem('paused', 'daily', { listSlugs: ['daily', 'my-vocabulary'], status: 'paused' }),
      makeItem('priority', 'accounting', { listSlugs: ['accounting', 'my-vocabulary'] })]
    const plan = buildDailyPlan({ items, tracks: createInitialTracks(items, NOW),
      settings: settings({ newItemsPerDay: 1 }), attempts: [], timeEntries: [], now: NOW })
    expect(new Set(plan.tasks.map((task) => task.itemId))).toEqual(new Set(['priority']))
  })

  it('counts already introduced priority words toward the fixed quota across continuations', () => {
    const priorityItems = Array.from({ length: 2 }, (_, index) => makeItem(`priority-${index}`, 'daily', {
      listSlugs: ['daily', 'my-vocabulary'],
    }))
    const ordinaryItems = Array.from({ length: 12 }, (_, index) => makeItem(`ordinary-${index}`))
    const items = [...ordinaryItems, ...priorityItems]
    const tracks = createInitialTracks(items, NOW).map((track) => track.itemId === 'priority-0'
      ? makeTrack(track.itemId, track.type, { due: '2026-08-20T00:00:00.000Z' }) : track)
    const input = { items, tracks, settings: settings({ newItemsPerDay: 7 }),
      attempts: [makeAttempt(0, 'priority-0')], timeEntries: [], now: NOW, additionalMinutes: 5 }
    const plan = buildDailyPlan(input)
    expect(plan).toMatchObject({ introducedToday: 1, remainingNewItems: 6, newItemCount: 6 })
    const selected = [...new Set(plan.tasks.filter((task) => task.isNew).map((task) => task.itemId))]
    expect(selected[0]).toBe('priority-1')
    expect(selected.filter((id) => id.startsWith('ordinary-'))).toHaveLength(5)
    const completed = buildDailyPlan({ ...input, attempts: [...input.attempts,
      ...selected.map((id, index) => makeAttempt(index + 1, id, { reviewedAt: NOW.toISOString() }))] })
    expect(completed).toMatchObject({ introducedToday: 7, remainingNewItems: 0, newItemCount: 0 })
  })

  it('only falls below the fixed quota when the active fresh vocabulary is insufficient', () => {
    const items = [makeItem('priority', 'daily', { listSlugs: ['daily', 'my-vocabulary'] }),
      makeItem('ordinary'), makeItem('paused', 'daily', { listSlugs: ['daily', 'my-vocabulary'], status: 'paused' })]
    const plan = buildDailyPlan({ items, tracks: createInitialTracks(items, NOW),
      settings: settings({ dailyMinutes: 5, newItemsPerDay: 7 }), attempts: [], timeEntries: [], now: NOW })
    expect([...new Set(plan.tasks.map((task) => task.itemId))]).toEqual(['priority', 'ordinary'])
    expect(plan.newItemCount).toBe(2)
    expect(plan.reasons).toContain('可学的新表达不足，按现有内容安排，不为凑足数量重复出题。')
  })

  it('shares recorded time without shrinking the configured daily new-word allowance', () => {
    const items = Array.from({ length: 20 }, (_, index) => makeItem(`fresh-${index}`))
    const tracks = createInitialTracks(items, NOW)
    const localDate = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`
    const input = { items, tracks, settings: settings({ dailyMinutes: 20, newItemsPerDay: 10 }), attempts: [], now: NOW,
      timeEntries: [
        { id: 'a', sessionId: 'a', localDate, activeMs: 8 * 60000, updatedAt: NOW.toISOString() },
        { id: 'b', sessionId: 'b', localDate, activeMs: 7 * 60000, updatedAt: NOW.toISOString() },
      ] }
    const plan = buildDailyPlan(input)
    expect(plan).toMatchObject({ usedMs: 15 * 60000, remainingMs: 5 * 60000, newItemCount: 10, totalTasks: 20, estimatedMinutes: 15 })
    expect(buildDailyPlan({ ...input, timeEntries: [], additionalMinutes: 5 }).remainingMs).toBe(5 * 60000)
    const exhausted = { ...input, timeEntries: [...input.timeEntries,
      { id: 'c', sessionId: 'c', localDate, activeMs: 5 * 60000, updatedAt: NOW.toISOString() }] }
    expect(buildDailyPlan(exhausted)).toMatchObject({ remainingMs: 0, newItemCount: 10, totalTasks: 20 })
    expect(buildDailyPlan({ ...exhausted, additionalMinutes: 5 }).remainingMs).toBe(5 * 60000)
  })

  it('never refunds new-item allowance when an introduced word is paused', () => {
    const items = [makeItem('started', 'daily', { status: 'paused' }), makeItem('fresh')]
    const plan = buildDailyPlan({ items, tracks: createInitialTracks(items, NOW),
      settings: settings({ newItemsPerDay: 1 }), attempts: [makeAttempt(0, 'started')], timeEntries: [], now: NOW })
    expect(plan).toMatchObject({ introducedToday: 1, remainingNewItems: 0, newItemCount: 0, totalTasks: 0 })
  })

  it('schedules the unfinished direction of an introduced item even with a zero new-item cap', () => {
    const items = [makeItem('partial'), makeItem('fresh')]
    const tracks = createInitialTracks(items, NOW).map((track) => track.id === 'partial:productive'
      ? makeTrack('partial', 'productive', { due: '2026-08-20T00:00:00.000Z' }) : track)
    const plan = buildDailyPlan({ items, tracks, settings: settings({ newItemsPerDay: 0 }),
      attempts: [makeAttempt(0, 'partial')], timeEntries: [], now: NOW })
    expect(plan.tasks.map((task) => task.trackId)).toEqual(['partial:receptive'])
    expect(plan).toMatchObject({ newItemCount: 0, reviewTaskCount: 1, reviewItemCount: 1 })
  })

  it('does not add fresh tasks before due work when the due tasks share an item', () => {
    const items = [makeItem('due'), makeItem('fresh')]
    const tracks = [makeTrack('due', 'receptive'), makeTrack('due', 'productive'), ...createInitialTracks([items[1]], NOW)]
    const plan = buildDailyPlan({ items, tracks, settings: settings({ newItemsPerDay: 1 }),
      attempts: [], timeEntries: [], now: NOW })
    expect(plan.tasks.slice(0, 2).map((task) => task.itemId)).toEqual(['due', 'due'])
  })

  it.each([
    { wasPriorityStudy: undefined, future: false, expected: 'fresh-business' },
    { wasPriorityStudy: false, future: false, expected: 'fresh-business' },
    { wasPriorityStudy: true, future: false, expected: 'fresh-daily' },
    { wasPriorityStudy: false, future: true, expected: 'fresh-daily' },
  ])('carries ordinary history across days using first-study membership: %j', ({ wasPriorityStudy, future, expected }) => {
    const items = [makeItem('old-daily', 'daily', {
      status: 'paused', listSlugs: wasPriorityStudy === false ? ['daily', 'my-vocabulary'] : ['daily'],
    }), makeItem('fresh-daily'), makeItem('fresh-business', 'business')]
    const tracks = [...createInitialTracks(items.slice(1), NOW),
      makeTrack('old-daily', 'receptive', { due: '2026-08-20T00:00:00.000Z' }),
      makeTrack('old-daily', 'productive', { due: '2026-08-20T00:00:00.000Z' })]
    const plan = buildDailyPlan({ items, tracks, settings: settings({ newItemsPerDay: 1,
      contentMix: { daily: 0.5, business: 0.5, finance: 0, accounting: 0 } }),
      attempts: [
        makeAttempt(1, 'old-daily', { reviewedAt: '2026-08-11T00:00:00.000Z', wasPriorityStudy: !wasPriorityStudy }),
        makeAttempt(0, 'old-daily', { reviewedAt: future ? '2026-08-12T00:00:00.000Z' : '2026-08-09T00:00:00.000Z', wasPriorityStudy }),
      ], timeEntries: [], now: NOW })
    expect(new Set(plan.tasks.map((task) => task.itemId))).toEqual(new Set([expected]))
  })

  it.each([
    { remainingMinutes: 1 },
    { remainingMinutes: 1.5 },
    { remainingMinutes: 0 },
    { remainingMinutes: -10 },
  ])('includes all due work regardless of recorded learning time: %j', ({ remainingMinutes }) => {
    const usage = makeItem('usage', 'daily', { usagePrompts: [{ id: 'usage-prompt', type: 'cloze',
      prompt: 'Use ___.', answer: 'usage', modelAnswer: 'Use usage.', checkpoints: ['usage'] }] })
    const items = [usage, makeItem('recall-a'), makeItem('recall-b'), makeItem('fresh')]
    const tracks = [
      makeTrack('usage', 'usage', { due: '2026-08-01T00:00:00.000Z' }),
      makeTrack('recall-a', 'receptive', { due: '2026-08-02T00:00:00.000Z' }),
      makeTrack('recall-b', 'productive', { due: '2026-08-03T00:00:00.000Z' }),
      ...createInitialTracks([items[3]], NOW),
    ]
    const localDate = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`
    const plan = buildDailyPlan({ items, tracks, settings: settings({ dailyMinutes: 5, newItemsPerDay: 1 }),
      attempts: [], timeEntries: [{ id: 'session', sessionId: 'session', localDate,
        activeMs: (5 - remainingMinutes) * 60000, updatedAt: NOW.toISOString() }], now: NOW })
    expect(plan.tasks.filter((task) => !task.isNew).map((task) => task.trackId)).toEqual(['usage:usage', 'recall-a:receptive', 'recall-b:productive'])
    expect(plan.overflowDueCount).toBe(0)
    expect(plan.estimatedMinutes).toBe(5)
    expect(plan.newItemCount).toBe(1)
  })
})

describe('evidence-aware usage unlocking', () => {
  const item = makeItem('usage', 'daily', { usagePrompts: [{ id: 'p', type: 'sentence',
    prompt: 'Write a sentence', modelAnswer: 'usage', checkpoints: ['usage'] }] })
  const tracks = createInitialTracks([item], NOW)
  const attempts = (['receptive', 'productive'] as const).map((type, index) => makeAttempt(index, item.id, {
    trackId: `${item.id}:${type}`, trackType: type, evidenceVersion: 1, retryCount: 0,
    evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', rating: 'hard',
  }))
  it('unlocks from correct slow recall and does not accept self-rated or hinted success', () => {
    expect(unlockEligibleUsageTracks(tracks, NOW, attempts).find((track) => track.type === 'usage')?.unlocked).toBe(true)
    expect(unlockEligibleUsageTracks(tracks, NOW, attempts.map((attempt) => ({ ...attempt, hintLevel: 1 })))
      .find((track) => track.type === 'usage')?.unlocked).toBe(false)
  })
  it('preserves historical eligibility, but locks after a new explicit failure until recovery', () => {
    const unlocked = tracks.map((track) => ({ ...track, unlocked: true }))
    expect(unlockEligibleUsageTracks(unlocked, NOW, []).find((track) => track.type === 'usage')?.unlocked).toBe(true)
    const failed = [...attempts, makeAttempt(20, item.id, { reviewedAt: NOW.toISOString(),
      evidenceVersion: 1, retryCount: 0, evaluationSource: 'reveal', correctness: 'incorrect', hintLevel: 3 })]
    expect(unlockEligibleUsageTracks(unlocked, NOW, failed).find((track) => track.type === 'usage')?.unlocked).toBe(false)
  })
})

describe('review scheduling and retry placement', () => {
  it('maps the three UI ratings through FSRS and persists good timestamps', () => {
    const base = createInitialTracks([makeItem('word')], NOW)[0]
    const hard = scheduleReview(base, 'hard', NOW, 0.9)
    const good = scheduleReview(base, 'good', NOW, 0.9)

    expect(good.reps).toBe(1)
    expect(good.state).toBe(State.Review)
    expect(new Date(good.due).getTime()).toBeGreaterThan(NOW.getTime())
    expect(good.firstGoodAt).toBe(NOW.toISOString())
    expect(good.lastGoodAt).toBe(NOW.toISOString())
    expect(good.stability).toBeGreaterThan(hard.stability)
    expect(hard.firstGoodAt).toBeUndefined()

    const lapsedAt = new Date(good.due)
    const lapsed = scheduleReview(good, 'again', lapsedAt, 0.9)
    expect(lapsed.lapses).toBe(good.lapses + 1)
    expect(lapsed.lastReview).toBe(lapsedAt.toISOString())
    expect(lapsed.firstGoodAt).toBeUndefined()
    expect(lapsed.lastGoodAt).toBeUndefined()

    const recovered = scheduleReview(lapsed, 'good', new Date(lapsedAt.getTime() + 60_000), 0.9)
    expect(recovered.firstGoodAt).toBe(recovered.lastGoodAt)
    expect(recovered.firstGoodAt).not.toBe(good.firstGoodAt)
  })

  it('clears good timestamps after again, but not after hard', () => {
    const base = createInitialTracks([makeItem('word')], NOW)[0]
    const good = scheduleReview(base, 'good', NOW, 0.9)
    const later = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000)
    const solid = scheduleReview(good, 'good', later, 0.9)
    const hard = scheduleReview(solid, 'hard', new Date(later.getTime() + 60_000), 0.9)

    expect(solid.firstGoodAt).toBe(NOW.toISOString())
    expect(solid.lastGoodAt).toBe(later.toISOString())
    expect(hard.firstGoodAt).toBe(NOW.toISOString())
    expect(hard.lastGoodAt).toBe(later.toISOString())
    expect(hard.lastReview).toBe(new Date(later.getTime() + 60_000).toISOString())
  })

  it('re-locks usage after again removes core good timestamps', () => {
    const item = makeItem('usable', 'daily', {
      usagePrompts: [{
        id: 'prompt',
        type: 'sentence',
        prompt: 'Write a sentence.',
        modelAnswer: 'This is usable.',
        checkpoints: ['usable'],
      }],
    })
    const seeded = createInitialTracks([item], NOW).map((track) => (
      track.type === 'usage'
        ? { ...track, unlocked: true, firstGoodAt: NOW.toISOString(), lastGoodAt: NOW.toISOString() }
        : {
          ...track,
          firstGoodAt: NOW.toISOString(),
          lastGoodAt: NOW.toISOString(),
        }
    ))
    const afterAgain = scheduleReview(
      seeded.find((track) => track.type === 'receptive')!,
      'again',
      new Date(NOW.getTime() + 60_000),
      0.9,
    )
    const replaced = seeded.map((track) => track.id === afterAgain.id ? afterAgain : track)
    const synced = unlockEligibleUsageTracks(replaced, new Date(NOW.getTime() + 60_000))

    expect(synced.find((track) => track.type === 'usage')?.unlocked).toBe(false)
  })
})

describe('requeueFailedTask', () => {
  it('requeues a failed task after a gap without mutating the pending queue', () => {
    const failed = {
      id: 'failed',
      itemId: 'failed-item',
      trackId: 'failed-item:productive',
      trackType: 'productive' as const,
      isNew: false,
    }
    const pending = ['a', 'b', 'c'].map((itemId) => ({
      id: itemId,
      itemId,
      trackId: `${itemId}:receptive`,
      trackType: 'receptive' as const,
      isNew: false,
    }))

    const result = requeueFailedTask(pending, failed, 2)

    expect(pending).toHaveLength(3)
    expect(result[2]).toMatchObject({ itemId: 'failed-item', retryCount: 1 })
    expect(result[2].id).toBe('failed:retry:1')
  })
})
