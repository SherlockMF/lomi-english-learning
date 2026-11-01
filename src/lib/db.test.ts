import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'

import {
  DEFAULT_SETTINGS,
  type DictionaryResult,
  type LearningTrack,
  type ReviewAttempt,
  type Word,
} from '../domain/types'
import { ALL_VOCABULARY_LISTS, LIST_IDS } from '../data/vocabularyLists'
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  clearDatabase,
  clearUserData,
  closeDatabase,
  deleteVocabularyItem,
  getAllLearningTracks,
  getAllReviewAttempts,
  getAllVocabulary,
  getDictionaryCache,
  getDueLearningTracks,
  getSettings,
  getDatabase,
  getUserDataSnapshot,
  hydrateWord,
  initializeDatabase,
  normalizeUserSettings,
  putStudyTimeEntry,
  recordReview,
  removeWordFromList,
  replaceUserData,
  setDictionaryCache,
  writeBatch,
} from './db'
import { createSerialQueue } from './serialQueue'

const timestamp = '2026-08-10T00:00:00.000Z'

function word(overrides: Partial<Word> = {}): Word {
  return {
    id: 'vocabulary-1',
    expression: 'asset',
    lemma: 'asset',
    senseKey: 'finance-noun-resource',
    zhGloss: '资产',
    enDefinition: 'A resource with economic value.',
    partOfSpeech: 'noun',
    acceptedZhAnswers: ['资产'],
    acceptedEnVariants: ['asset'],
    examples: [{ en: 'Cash is a current asset.', zh: '现金是流动资产。' }],
    collocations: ['current asset'],
    source: 'seed',
    priority: 1,
    status: 'active',
    usagePrompts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function track(overrides: Partial<LearningTrack> = {}): LearningTrack {
  return {
    id: 'track-1',
    itemId: 'vocabulary-1',
    type: 'receptive',
    due: timestamp,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    unlocked: true,
    ...overrides,
  }
}

function attempt(overrides: Partial<ReviewAttempt> = {}): ReviewAttempt {
  return {
    id: 'attempt-1',
    trackId: 'track-1',
    itemId: 'vocabulary-1',
    trackType: 'receptive',
    promptType: 'definition',
    answer: '资产',
    rating: 'good',
    hintLevel: 0,
    responseMs: 1_200,
    reviewedAt: timestamp,
    ...overrides,
  }
}

describe('IndexedDB persistence', () => {
  it('does not mark words with no memberships as priority words', () => {
    expect(hydrateWord(word({ source: 'custom' }), []).listSlugs).toEqual([])
  })
  beforeEach(async () => {
    await closeDatabase()
    await deleteDB(DATABASE_NAME)
  })

  afterEach(async () => {
    await closeDatabase()
    await deleteDB(DATABASE_NAME)
  })

  it('removes the last priority membership, including legacy ids, without removing the custom word or learning history', async () => {
    await writeBatch({ words: [word({ source: 'custom' })], lists: ALL_VOCABULARY_LISTS,
      memberships: [{ id: 'legacy-priority-membership', wordId: word().id,
        listId: LIST_IDS['my-vocabulary'], priority: 1, sortOrder: 0 }],
      tracks: [track({ reps: 2 })], attempts: [attempt()] })
    const before = await getUserDataSnapshot()
    await removeWordFromList(word().id, 'my-vocabulary')
    await closeDatabase()
    const after = await getUserDataSnapshot()
    expect(after.vocabulary[0].listSlugs).toEqual([])
    expect(after.words).toEqual(before.words)
    expect(after.tracks).toEqual(before.tracks)
    expect(after.attempts).toEqual(before.attempts)
    await removeWordFromList(word().id, 'my-vocabulary')
    expect((await getUserDataSnapshot()).memberships).toEqual([])
  })

  it('migrates the core budget without adding extension time and bounds settings', () => {
    expect(normalizeUserSettings({ coreMinutes: 20, extensionMinutes: 40, newItemsPerDay: 0 }))
      .toMatchObject({ dailyMinutes: 20, newItemsPerDay: 0 })
    expect(normalizeUserSettings({ dailyMinutes: 180, newItemsPerDay: 150 }))
      .toMatchObject({ dailyMinutes: 120, newItemsPerDay: 100 })
    expect(normalizeUserSettings({ dailyMinutes: 4.5, newItemsPerDay: -1 }))
      .toMatchObject({ dailyMinutes: 5, newItemsPerDay: 0 })
    expect(normalizeUserSettings({ dailyMinutes: NaN, newItemsPerDay: NaN }))
      .toMatchObject({ dailyMinutes: 15, newItemsPerDay: 5 })
  })

  it('upgrades V2 without changing learning records or inventing study time', async () => {
    const previous = await openDB(DATABASE_NAME, 2, {
      upgrade(database) {
        database.createObjectStore('words', { keyPath: 'id' })
        database.createObjectStore('tracks', { keyPath: 'id' })
        database.createObjectStore('attempts', { keyPath: 'id' })
        database.createObjectStore('settings', { keyPath: 'id' })
        database.createObjectStore('vocabularyLists', { keyPath: 'id' })
        database.createObjectStore('wordListItems', { keyPath: 'id' })
      },
    })
    await previous.put('words', word())
    await previous.put('tracks', track({ reps: 8, stability: 12 }))
    await previous.put('attempts', attempt())
    const { dailyMinutes: _dailyMinutes, ...legacySettings } = DEFAULT_SETTINGS
    await previous.put('settings', { ...legacySettings, coreMinutes: 20 })
    previous.close()

    const snapshot = await getUserDataSnapshot()
    expect((await getDatabase()).version).toBe(DATABASE_VERSION)
    expect(snapshot.settings.dailyMinutes).toBe(20)
    expect(snapshot.tracks).toEqual([track({ reps: 8, stability: 12 })])
    expect(snapshot.attempts).toEqual([attempt()])
    expect(snapshot.timeEntries).toEqual([])
  })

  it('adds voice history to V4 without changing existing vocabulary or review records', async () => {
    const previous = await openDB(DATABASE_NAME, 4, {
      upgrade(database) {
        for (const store of ['words', 'tracks', 'attempts', 'settings', 'vocabularyLists', 'wordListItems', 'timeEntries']) {
          database.createObjectStore(store, { keyPath: 'id' })
        }
      },
    })
    await previous.put('words', word())
    await previous.put('tracks', track({ reps: 8, stability: 12 }))
    await previous.put('attempts', attempt())
    await previous.put('settings', DEFAULT_SETTINGS)
    previous.close()
    const snapshot = await getUserDataSnapshot()
    const database = await getDatabase()
    expect(database.version).toBe(DATABASE_VERSION)
    expect(await database.getAll('voiceHistory')).toEqual([])
    expect(snapshot.words).toEqual([word()])
    expect(snapshot.tracks).toEqual([track({ reps: 8, stability: 12 })])
    expect(snapshot.attempts).toEqual([attempt()])
  })

  it('upgrades V1 vocabulary and settings directly to V3 while preserving review IDs', async () => {
    const previous = await openDB(DATABASE_NAME, 1, {
      upgrade(database) {
        database.createObjectStore('vocabulary', { keyPath: 'id' })
        database.createObjectStore('tracks', { keyPath: 'id' })
        database.createObjectStore('attempts', { keyPath: 'id' })
        database.createObjectStore('settings', { keyPath: 'id' })
      },
    })
    await previous.put('vocabulary', { ...word(), category: 'finance' })
    await previous.put('tracks', track({ reps: 5 }))
    await previous.put('attempts', attempt())
    const { dailyMinutes: _dailyMinutes, ...legacySettings } = DEFAULT_SETTINGS
    await previous.put('settings', {
      ...legacySettings, coreMinutes: 25,
      contentMix: { daily: 0.4, business: 0.25, finance: 0.35 },
    })
    previous.close()

    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words[0].id).toBe('vocabulary-1')
    expect(snapshot.vocabulary[0].listSlugs).toEqual(['accounting'])
    expect(snapshot.tracks).toEqual([track({ reps: 5 })])
    expect(snapshot.attempts).toEqual([attempt()])
    expect(snapshot.settings.dailyMinutes).toBe(25)
    expect(snapshot.settings.contentMix).toEqual({ daily: 0.4, business: 0.25, finance: 0.175, accounting: 0.175 })
    expect(snapshot.timeEntries).toEqual([])
  })

  it('refreshes old seed bodies after a V2 upgrade when the content revision is unknown', async () => {
    const previous = await openDB(DATABASE_NAME, 2, {
      upgrade(database) {
        database.createObjectStore('words', { keyPath: 'id' })
        database.createObjectStore('tracks', { keyPath: 'id' })
        database.createObjectStore('attempts', { keyPath: 'id' })
        database.createObjectStore('settings', { keyPath: 'id' })
      },
    })
    await previous.put('words', word({ zhGloss: 'old seed body' }))
    await previous.put('tracks', track({ reps: 12, stability: 40 }))
    const { dailyMinutes: _dailyMinutes, seedContentRevision: _revision, ...legacySettings } = DEFAULT_SETTINGS
    await previous.put('settings', legacySettings)
    previous.close()

    await initializeDatabase([word({ zhGloss: 'refreshed seed body' })])
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words[0].zhGloss).toBe('refreshed seed body')
    expect(snapshot.tracks).toEqual([track({ reps: 12, stability: 40 })])
    expect(snapshot.settings.seedContentRevision).toBe(DEFAULT_SETTINGS.seedContentRevision)
  })

  it('upserts cumulative study time without double counting or decreasing saved time', async () => {
    const entry = { id: 'session-1:2026-08-10', sessionId: 'session-1', localDate: '2026-08-10', activeMs: 5_000, updatedAt: timestamp }
    await putStudyTimeEntry(entry)
    await Promise.all([
      putStudyTimeEntry({ ...entry, activeMs: 15_000 }),
      putStudyTimeEntry({ ...entry, activeMs: 10_000 }),
      putStudyTimeEntry(entry),
    ])
    expect((await getUserDataSnapshot()).timeEntries).toEqual([{ ...entry, activeMs: 15_000 }])
    await clearUserData()
    expect((await getUserDataSnapshot()).timeEntries).toEqual([])
  })

  it('replaces and clears the study-time ledger with the rest of the user data', async () => {
    const entry = { id: 'session-1:2026-08-10', sessionId: 'session-1', localDate: '2026-08-10', activeMs: 5_000, updatedAt: timestamp }
    await writeBatch({ timeEntries: [entry] })
    await replaceUserData({ words: [], lists: [], memberships: [], tracks: [], attempts: [], settings: DEFAULT_SETTINGS })
    expect((await getUserDataSnapshot()).timeEntries).toEqual([])
    await replaceUserData({ words: [], lists: [], memberships: [], tracks: [], attempts: [], timeEntries: [entry], settings: DEFAULT_SETTINGS })
    expect((await getUserDataSnapshot()).timeEntries).toEqual([entry])
    await clearDatabase()
    expect((await getUserDataSnapshot()).timeEntries).toEqual([])
  })

  it('saves a repeated attempt only once and preserves the frozen submission time', async () => {
    await writeBatch({ tracks: [track()] })
    const input = {
      trackId: 'track-1', rating: 'good' as const, desiredRetention: 0.9,
      attempt: attempt({ evidenceVersion: 1, sessionId: 'session-1', retryCount: 0, evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good' }),
      reviewedAt: new Date(timestamp),
    }
    const first = await recordReview(input)
    const again = await recordReview({ ...input, rating: 'again', reviewedAt: new Date('2026-08-11T00:00:00.000Z') })
    expect(again.attempt).toEqual(first.attempt)
    expect(again.changedTracks).toEqual([])
    expect(again.reviewedAt).toEqual(new Date(timestamp))
    expect(await getAllLearningTracks()).toEqual(first.tracks)
    expect(await getAllReviewAttempts()).toEqual([first.attempt])
  })

  it('unlocks application from saved objective success even when the response was slow', async () => {
    await writeBatch({
      tracks: [
        track(),
        track({ id: 'productive-1', type: 'productive' }),
        track({ id: 'usage-1', type: 'usage', unlocked: false }),
      ],
      attempts: [attempt({ evidenceVersion: 1, sessionId: 'session-1', retryCount: 0, evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good' })],
    })
    const result = await recordReview({
      trackId: 'productive-1', rating: 'hard', desiredRetention: 0.9,
      attempt: attempt({ id: 'productive-success', trackType: 'productive', evidenceVersion: 1, sessionId: 'session-1', retryCount: 0, evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'hard' }),
      reviewedAt: new Date(timestamp),
    })
    expect(result.tracks.find((candidate) => candidate.id === 'usage-1')?.unlocked).toBe(true)
  })

  it('does not unlock application from overridden self-ratings', async () => {
    await writeBatch({ tracks: [
      track({ firstGoodAt: timestamp, lastGoodAt: timestamp }),
      track({ id: 'productive-1', type: 'productive', firstGoodAt: timestamp, lastGoodAt: timestamp }),
      track({ id: 'usage-1', type: 'usage', unlocked: false }),
    ] })
    const result = await recordReview({
      trackId: 'productive-1', rating: 'good', desiredRetention: 0.9,
      attempt: attempt({ wasOverride: true, evidenceVersion: 1, sessionId: 'session-1', retryCount: 0, evaluationSource: 'rules', correctness: 'unverified', matchKind: 'incorrect', suggestedRating: 'again' }),
      reviewedAt: new Date(timestamp),
    })
    expect(result.tracks.find((candidate) => candidate.id === 'usage-1')?.unlocked).toBe(false)
  })

  it('does not overwrite existing words when re-seeding the same ids', async () => {
    await initializeDatabase(
      [word()],
      [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      [track()],
    )

    await writeBatch({
      words: [word({ expression: 'asset (edited)' })],
    })
    await initializeDatabase(
      [word({ expression: 'replacement seed' })],
      [],
      [track({ id: 'replacement-track' })],
    )

    expect(await getAllVocabulary()).toEqual([
      expect.objectContaining({
        expression: 'asset (edited)',
        listSlugs: ['accounting'],
        category: 'accounting',
      }),
    ])
    expect(await getAllLearningTracks()).toHaveLength(1)
    expect(await getSettings()).toEqual(expect.objectContaining({
      ...DEFAULT_SETTINGS,
      seedContentRevision: DEFAULT_SETTINGS.seedContentRevision,
    }))
  })

  it('refreshes seed word bodies when seedContentRevision changes', async () => {
    await initializeDatabase(
      [word({ enDefinition: 'old definition' })],
      [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      [track()],
      { ...DEFAULT_SETTINGS, seedContentRevision: '5.2.0' },
    )

    await initializeDatabase(
      [word({ enDefinition: 'V5.3 refreshed definition', zhGloss: '资产（修订）' })],
      [],
      [],
      { ...DEFAULT_SETTINGS, seedContentRevision: '5.3.0' },
    )

    expect(await getAllVocabulary()).toEqual([
      expect.objectContaining({
        id: 'vocabulary-1',
        enDefinition: 'V5.3 refreshed definition',
        zhGloss: '资产（修订）',
      }),
    ])
    expect(await getAllLearningTracks()).toHaveLength(1)
    expect(await getSettings()).toEqual(expect.objectContaining({ seedContentRevision: '5.3.0' }))
  })

  it('refreshes unedited seed content while preserving all personal study choices', async () => {
    await initializeDatabase([word()], [], [track()], { ...DEFAULT_SETTINGS, seedContentRevision: 'old' })
    const personal = { ...word(), status: 'paused' as const, priority: 8, knownAt: timestamp,
      vocabularyLevel: 'C1' as const, contentEdited: false, updatedAt: '2026-10-12T00:00:00.000Z' }
    await writeBatch({ words: [personal] })
    await initializeDatabase([word({ enDefinition: 'Corrected source definition' })], [], undefined,
      { ...DEFAULT_SETTINGS, seedContentRevision: 'new' })
    expect((await getUserDataSnapshot()).words[0]).toMatchObject({ enDefinition: 'Corrected source definition',
      status: 'paused', priority: 8, knownAt: timestamp, vocabularyLevel: 'C1' })
    expect(await getAllLearningTracks()).toEqual([track()])
  })

  it('keeps explicitly edited seed bodies through an upgrade', async () => {
    await initializeDatabase([word()], [], [track()], { ...DEFAULT_SETTINGS, seedContentRevision: 'old' })
    const edited = { ...word(), contentEdited: true, enDefinition: 'Personal definition', zhGloss: '个人释义' }
    await writeBatch({ words: [edited] })
    await initializeDatabase([word({ enDefinition: 'Replacement source' })], [], undefined,
      { ...DEFAULT_SETTINGS, seedContentRevision: 'new' })
    expect((await getUserDataSnapshot()).words[0]).toEqual(edited)
    expect(await getAllLearningTracks()).toEqual([track()])
  })

  it('conservatively retains legacy edits without an edit marker', async () => {
    await initializeDatabase([word()], [], undefined, { ...DEFAULT_SETTINGS, seedContentRevision: 'old' })
    const edited = word({ enDefinition: 'Legacy personal definition', updatedAt: '2026-10-12T00:00:00.000Z' })
    await writeBatch({ words: [edited] })
    await initializeDatabase([word({ enDefinition: 'Replacement source' })], [], undefined,
      { ...DEFAULT_SETTINGS, seedContentRevision: 'new' })
    expect((await getUserDataSnapshot()).words[0]).toMatchObject({ ...edited, contentEdited: true })
  })

  it('continues refreshing untouched source content across successive timestamp changes', async () => {
    await initializeDatabase([word()], [], undefined, { ...DEFAULT_SETTINGS, seedContentRevision: 'one' })
    for (const [revision, changedAt] of [['two', '2026-09-01T00:00:00.000Z'], ['three', '2026-10-01T00:00:00.000Z']]) {
      await initializeDatabase([word({ enDefinition: revision, createdAt: changedAt, updatedAt: changedAt })], [], undefined,
        { ...DEFAULT_SETTINGS, seedContentRevision: revision })
      expect((await getUserDataSnapshot()).words[0]).toMatchObject({ enDefinition: revision, createdAt: timestamp,
        updatedAt: changedAt, contentEdited: false })
    }
  })

  it('merges newly added seed words into an existing library', async () => {
    await initializeDatabase(
      [word()],
      [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      [track()],
    )

    const extra = word({
      id: 'seed-pack-1',
      expression: 'cash flow',
      lemma: 'cash flow',
      senseKey: 'core-cash-flow',
      zhGloss: '现金流',
    })
    await initializeDatabase(
      [word(), extra],
      [
        {
          id: 'membership-vocabulary-1-accounting',
          wordId: 'vocabulary-1',
          listId: LIST_IDS.accounting,
          priority: 1,
          sortOrder: 0,
        },
        {
          id: 'membership-seed-pack-1-finance',
          wordId: 'seed-pack-1',
          listId: LIST_IDS.finance,
          priority: 1,
          sortOrder: 1,
        },
      ],
      [],
    )

    const vocabulary = await getAllVocabulary()
    expect(vocabulary).toHaveLength(2)
    expect(vocabulary).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vocabulary-1', expression: 'asset' }),
      expect.objectContaining({
        id: 'seed-pack-1',
        expression: 'cash flow',
        listSlugs: ['finance'],
      }),
    ]))
    expect(await getAllLearningTracks()).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'vocabulary-1' }),
      expect.objectContaining({ itemId: 'seed-pack-1', type: 'receptive' }),
      expect.objectContaining({ itemId: 'seed-pack-1', type: 'productive' }),
    ]))
  })

  it('writes related records in a batch and queries due tracks', async () => {
    await writeBatch({
      words: [word()],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      tracks: [track()],
      attempts: [attempt()],
      settings: { ...DEFAULT_SETTINGS, newItemsPerDay: 8 },
    })

    expect(await getAllVocabulary()).toHaveLength(1)
    expect(await getAllLearningTracks()).toHaveLength(1)
    expect(await getAllReviewAttempts()).toEqual([attempt()])
    expect(await getDueLearningTracks('2026-08-10T12:00:00.000Z')).toEqual([track()])
    expect((await getSettings()).newItemsPerDay).toBe(8)

    await deleteVocabularyItem('vocabulary-1')
    expect(await getAllVocabulary()).toEqual([])
    expect(await getAllLearningTracks()).toEqual([])
    expect(await getAllReviewAttempts()).toEqual([])
  })

  it('keeps dictionaryCache separate from words and user-data replacement', async () => {
    const result: DictionaryResult = {
      query: 'Asset',
      word: 'asset',
      meanings: [
        {
          partOfSpeech: 'noun',
          definition: 'A resource with economic value.',
          synonyms: [],
        },
      ],
      fetchedAt: timestamp,
    }
    await setDictionaryCache('  AsSeT ', result, timestamp)

    expect(await getDictionaryCache('asset')).toEqual({
      query: 'asset',
      result,
      cachedAt: timestamp,
    })

    await replaceUserData({
      words: [word()],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      tracks: [track()],
      attempts: [attempt()],
      settings: DEFAULT_SETTINGS,
    })
    expect(await getDictionaryCache('ASSET')).toBeDefined()
    expect(await getAllVocabulary()).toHaveLength(1)

    await clearDatabase()
    expect(await getAllVocabulary()).toEqual([])
    expect(await getDictionaryCache('asset')).toBeUndefined()
  })

  it('applies reviews from IndexedDB state so stale snapshots cannot overwrite newer tracks', async () => {
    await writeBatch({
      words: [word()],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      tracks: [track({ reps: 0, state: 0 })],
      settings: DEFAULT_SETTINGS,
    })

    const first = await recordReview({
      trackId: 'track-1',
      rating: 'good',
      desiredRetention: 0.9,
      attempt: {
        id: 'attempt-first',
        itemId: 'vocabulary-1',
        trackType: 'receptive',
        promptType: 'definition',
        answer: '资产',
        hintLevel: 0,
        responseMs: 1_000,
      },
      reviewedAt: new Date('2026-08-10T01:00:00.000Z'),
    })

    const second = await recordReview({
      trackId: 'track-1',
      rating: 'good',
      desiredRetention: 0.9,
      attempt: {
        id: 'attempt-second',
        itemId: 'vocabulary-1',
        trackType: 'receptive',
        promptType: 'definition',
        answer: '资产',
        hintLevel: 0,
        responseMs: 1_200,
      },
      reviewedAt: new Date('2026-08-10T02:00:00.000Z'),
    })

    const stored = await getAllLearningTracks()
    expect(stored).toEqual([
      expect.objectContaining({
        id: 'track-1',
        reps: 2,
        lastGoodAt: '2026-08-10T02:00:00.000Z',
      }),
    ])
    expect(first.attempt.id).toBe('attempt-first')
    expect(second.attempt.id).toBe('attempt-second')
    expect(await getAllReviewAttempts()).toHaveLength(2)
  })

  it('creates initial tracks itself when seedTracks are omitted on an empty library', async () => {
    const result = await initializeDatabase(
      [word()],
      [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
    )

    expect(result).toMatchObject({ seeded: true, skipped: false })
    expect(await getAllLearningTracks()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vocabulary-1:receptive' }),
      expect.objectContaining({ id: 'vocabulary-1:productive' }),
    ]))
  })

  it('preserves personal known and level overrides when seed bodies refresh; normalizes legacy difficulty settings', async () => {
    await writeBatch({ words: [word({ knownAt: timestamp, vocabularyLevel: 'C1' })],
      settings: { ...DEFAULT_SETTINGS, seedContentRevision: 'old' } })
    await initializeDatabase([word({ zhGloss: '新定义' })], [], undefined, { ...DEFAULT_SETTINGS, seedContentRevision: 'new' }, ALL_VOCABULARY_LISTS)
    expect((await getUserDataSnapshot()).words[0]).toMatchObject({ knownAt: timestamp, vocabularyLevel: 'C1', zhGloss: '新定义' })
    expect(normalizeUserSettings({})).toMatchObject({ vocabularyLevel: 'B1', adaptiveDifficulty: true })
    expect(normalizeUserSettings({ vocabularyLevel: 'C9' as never, difficultyResetAt: 'invalid' })).toMatchObject({ vocabularyLevel: 'B1', difficultyResetAt: undefined })
  })

  it('skips heavy seed writes when revision matches and no new seed ids appear', async () => {
    await initializeDatabase(
      [word()],
      [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      [track()],
      { ...DEFAULT_SETTINGS, seedContentRevision: 'ready-1' },
    )

    const result = await initializeDatabase(
      [word(), word({
        id: 'vocabulary-1',
        expression: 'asset',
        senseKey: 'finance-noun-resource',
      })],
      [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      undefined,
      { ...DEFAULT_SETTINGS, seedContentRevision: 'ready-1' },
    )

    expect(result).toMatchObject({ seeded: false, skipped: true })
    expect(await getAllVocabulary()).toHaveLength(1)
    expect(await getAllLearningTracks()).toHaveLength(1)
  })

  it('reviews only the current item tracks without rewriting the full library', async () => {
    const distractorTracks = Array.from({ length: 40 }, (_, index) => track({
      id: `noise-${index}`,
      itemId: `noise-item-${index}`,
      type: index % 2 === 0 ? 'receptive' : 'productive',
      reps: 3,
      state: 2,
    }))
    await writeBatch({
      words: [word()],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      tracks: [
        track({ id: 'track-receptive', type: 'receptive', reps: 0, state: 0 }),
        track({ id: 'track-productive', type: 'productive', reps: 1, state: 1, firstGoodAt: timestamp, lastGoodAt: timestamp }),
        track({ id: 'track-usage', type: 'usage', unlocked: false, reps: 0, state: 0 }),
        ...distractorTracks,
      ],
      attempts: [attempt({
        id: 'productive-proof', trackId: 'track-productive', trackType: 'productive',
        evidenceVersion: 1, sessionId: 'session-before', retryCount: 0,
        evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good',
      })],
      settings: DEFAULT_SETTINGS,
    })

    const result = await recordReview({
      trackId: 'track-receptive',
      rating: 'good',
      desiredRetention: 0.9,
      attempt: {
        id: 'attempt-unlock',
        itemId: 'vocabulary-1',
        trackType: 'receptive',
        promptType: 'definition',
        answer: '资产',
        hintLevel: 0,
        responseMs: 900,
        evidenceVersion: 1, sessionId: 'session-1', retryCount: 0,
        evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good',
      },
      reviewedAt: new Date('2026-08-10T03:00:00.000Z'),
    })

    expect(result.tracks).toHaveLength(3)
    expect(result.changedTracks.some((candidate) => candidate.id === 'track-usage' && candidate.unlocked)).toBe(true)
    expect(result.tracks.every((candidate) => candidate.itemId === 'vocabulary-1')).toBe(true)

    const stored = await getAllLearningTracks()
    expect(stored).toHaveLength(43)
    expect(stored.find((candidate) => candidate.id === 'noise-0')).toEqual(expect.objectContaining({
      id: 'noise-0',
      reps: 3,
    }))
    expect(stored.find((candidate) => candidate.id === 'track-usage')).toEqual(expect.objectContaining({
      unlocked: true,
    }))
  })

  it('serializes overlapping same-item reviews so usage unlock is not overwritten', async () => {
    await writeBatch({
      words: [word()],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      tracks: [
        track({ id: 'track-receptive', type: 'receptive', reps: 0, state: 0 }),
        track({ id: 'track-productive', type: 'productive', reps: 0, state: 0 }),
        track({ id: 'track-usage', type: 'usage', unlocked: false, reps: 0, state: 0 }),
      ],
      settings: DEFAULT_SETTINGS,
    })

    const enqueue = createSerialQueue()
    const first = enqueue(() => recordReview({
      trackId: 'track-receptive',
      rating: 'good',
      desiredRetention: 0.9,
      attempt: {
        id: 'attempt-receptive',
        itemId: 'vocabulary-1',
        trackType: 'receptive',
        promptType: 'definition',
        answer: '资产',
        hintLevel: 0,
        responseMs: 800,
        evidenceVersion: 1, sessionId: 'session-1', retryCount: 0,
        evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good',
      },
      reviewedAt: new Date('2026-08-10T04:00:00.000Z'),
    }))
    const second = enqueue(() => recordReview({
      trackId: 'track-productive',
      rating: 'good',
      desiredRetention: 0.9,
      attempt: {
        id: 'attempt-productive',
        itemId: 'vocabulary-1',
        trackType: 'productive',
        promptType: 'expression',
        answer: 'asset',
        hintLevel: 0,
        responseMs: 900,
        evidenceVersion: 1, sessionId: 'session-1', retryCount: 0,
        evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good',
      },
      reviewedAt: new Date('2026-08-10T04:00:01.000Z'),
    }))

    await Promise.all([first, second])
    const stored = await getAllLearningTracks()
    expect(stored.find((candidate) => candidate.id === 'track-usage')).toEqual(expect.objectContaining({
      unlocked: true,
    }))
    expect(stored.find((candidate) => candidate.id === 'track-receptive')?.reps).toBeGreaterThan(0)
    expect(stored.find((candidate) => candidate.id === 'track-productive')?.reps).toBeGreaterThan(0)
  })
})
