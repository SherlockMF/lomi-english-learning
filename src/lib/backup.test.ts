import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'

import {
  DEFAULT_SETTINGS,
  type BackupV1,
  type BackupV3,
  type LearningTrack,
  type ReviewAttempt,
  type Word,
} from '../domain/types'
import { ALL_VOCABULARY_LISTS, LIST_IDS } from '../data/vocabularyLists'
import {
  DATABASE_NAME,
  closeDatabase,
  getAllLearningTracks,
  getAllReviewAttempts,
  getAllVocabulary,
  getSettings,
  getUserDataSnapshot,
  initializeDatabase,
  writeBatch,
} from './db'
import {
  BackupValidationError,
  exportBackup,
  importBackup,
  markBackupExported,
  parseBackup,
  parseBackupV2,
  parseBackupV3,
} from './backup'

const older = '2026-08-09T00:00:00.000Z'
const newer = '2026-08-10T00:00:00.000Z'

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
    examples: [],
    collocations: ['current asset'],
    source: 'seed',
    priority: 1,
    status: 'active',
    usagePrompts: [],
    createdAt: older,
    updatedAt: older,
    ...overrides,
  }
}

function track(overrides: Partial<LearningTrack> = {}): LearningTrack {
  return {
    id: 'track-1',
    itemId: 'vocabulary-1',
    type: 'receptive',
    due: older,
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
    responseMs: 1_000,
    reviewedAt: newer,
    ...overrides,
  }
}

function backupV1(overrides: Partial<BackupV1> = {}): BackupV1 {
  return {
    version: 1,
    exportedAt: newer,
    vocabulary: [{
      ...word(),
      category: 'finance',
    }],
    tracks: [track()],
    attempts: [attempt()],
    settings: {
      ...DEFAULT_SETTINGS,
      contentMix: { ...DEFAULT_SETTINGS.contentMix, daily: 0.4, finance: 0.35, business: 0.25, accounting: 0 },
    },
    ...overrides,
  }
}

describe('backup import and export', () => {
  it('round-trips scheduling baselines and rejects a baseline from another track', () => {
    const data: BackupV3 = { version: 3, exportedAt: newer, words: [word()], lists: [...ALL_VOCABULARY_LISTS], memberships: [], tracks: [track()], attempts: [attempt({ desiredRetention: 0.85, trackBefore: track() })], timeEntries: [], settings: DEFAULT_SETTINGS }
    expect(parseBackupV3(JSON.stringify(data)).attempts[0].trackBefore).toEqual(track())
    expect(() => parseBackupV3({ ...data, attempts: [attempt({ desiredRetention: 0.85, trackBefore: track({ itemId: 'other' }) })] })).toThrow()
  })
  it('remaps nested scheduling baselines when equivalent words and tracks are deduplicated', () => {
    const words = [word({ id: 'first' }), word({ id: 'second' })]
    const tracks = [track({ id: 'first-track', itemId: 'first' }), track({ id: 'second-track', itemId: 'second' })]
    const attempts = [attempt({ itemId: 'second', trackId: 'second-track', desiredRetention: 0.9, trackBefore: tracks[1] })]
    const modern = parseBackupV3({ version: 3, exportedAt: newer, words, lists: ALL_VOCABULARY_LISTS, memberships: [], tracks, attempts, timeEntries: [], settings: DEFAULT_SETTINGS })
    expect(() => parseBackupV3(JSON.stringify(modern))).not.toThrow()
    expect(modern.attempts[0].trackBefore?.id).toBe(modern.attempts[0].trackId)
    const legacy = parseBackup(backupV1({ vocabulary: words.map(value => ({ ...value, category: 'daily' })), tracks, attempts }))
    expect(() => parseBackup(JSON.stringify(legacy))).not.toThrow()
    expect(legacy.attempts[0].trackBefore?.itemId).toBe(legacy.attempts[0].itemId)
  })
  beforeEach(async () => {
    await closeDatabase()
    await deleteDB(DATABASE_NAME)
  })

  afterEach(async () => {
    await closeDatabase()
    await deleteDB(DATABASE_NAME)
  })

  it('exports a validated V3 snapshot and records the backup time', async () => {
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
      settings: DEFAULT_SETTINGS,
    })

    const exported = await exportBackup(new Date(newer))

    expect(exported).toMatchObject({
      version: 3,
      exportedAt: newer,
      settings: { lastBackupAt: newer },
    })
    expect(exported.words).toHaveLength(1)
    expect(exported.memberships).toHaveLength(1)
    // Building the export alone must not stamp the local settings; only an
    // actual export does.
    expect((await getSettings()).lastBackupAt).toBeUndefined()
    await markBackupExported(new Date(newer))
    expect((await getSettings()).lastBackupAt).toBe(newer)
    expect(exported.timeEntries).toEqual([])
  })

  it('round-trips known marks, lexical overrides and adaptive history and rejects invalid difficulty fields', async () => {
    await writeBatch({ words: [word({ knownAt: newer, vocabularyLevel: 'C1' })], tracks: [track()],
      attempts: [attempt({ wasNewItem: true, wasPriorityStudy: false })],
      settings: { ...DEFAULT_SETTINGS, vocabularyLevel: 'B2', adaptiveDifficulty: false, difficultyResetAt: newer } })
    const exported = await exportBackup()
    const parsed = parseBackupV3(JSON.stringify(exported))
    expect(parsed.words[0]).toMatchObject({ knownAt: newer, vocabularyLevel: 'C1' })
    expect(parsed.settings).toMatchObject({ vocabularyLevel: 'B2', adaptiveDifficulty: false, difficultyResetAt: newer })
    expect(parsed.attempts[0]).toMatchObject({ wasNewItem: true, wasPriorityStudy: false })
    await importBackup(parsed)
    expect((await getAllVocabulary())[0]).toMatchObject({ knownAt: newer, vocabularyLevel: 'C1' })
    for (const patch of [{ vocabularyLevel: 'C3' }, { knownAt: 'invalid' }]) {
      expect(() => parseBackupV3({ ...exported, words: [{ ...exported.words[0], ...patch }] })).toThrow(BackupValidationError)
    }
    expect(() => parseBackupV3({ ...exported, settings: { ...exported.settings, adaptiveDifficulty: 'yes' } })).toThrow(BackupValidationError)
  })

  it('round-trips the personal content marker and rejects non-boolean markers', async () => {
    const edited = word({ contentEdited: true, zhGloss: '个人释义', status: 'paused', priority: 7 })
    await writeBatch({ words: [edited], tracks: [track({ reps: 12, stability: 40 })], attempts: [attempt()],
      settings: { ...DEFAULT_SETTINGS, seedContentRevision: 'old' } })
    const exported = await exportBackup(new Date(newer))
    const parsed = parseBackupV3(JSON.stringify(exported))
    expect(parsed.words[0]).toMatchObject({ contentEdited: true })
    await importBackup(parsed)
    const restored = await getUserDataSnapshot()
    await initializeDatabase([word({ zhGloss: '新版种子释义' })], [], undefined,
      { ...DEFAULT_SETTINGS, seedContentRevision: 'new' })
    const upgraded = await getUserDataSnapshot()
    expect(upgraded.words[0]).toEqual(edited)
    expect(upgraded.tracks).toEqual(restored.tracks)
    expect(upgraded.attempts).toEqual(restored.attempts)
    expect(() => parseBackupV3({ ...exported, words: [{ ...exported.words[0], contentEdited: 'yes' }] }))
      .toThrow(BackupValidationError)
  })

  it('round-trips V3 budgets, study time and evidence without altering FSRS or IDs', async () => {
    const evidence = attempt({
      evidenceVersion: 1, sessionId: 'session-1', retryCount: 0, promptId: 'prompt-1',
      evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good',
    })
    const timeEntry = { id: 'session-1:2026-08-10', sessionId: 'session-1', localDate: '2026-08-10', activeMs: 123_000, updatedAt: newer }
    await writeBatch({
      words: [word()], lists: ALL_VOCABULARY_LISTS, tracks: [track({ reps: 12, stability: 40 })],
      attempts: [evidence], timeEntries: [timeEntry], settings: { ...DEFAULT_SETTINGS, dailyMinutes: 20 },
    })
    const exported = await exportBackup(new Date(newer))
    const parsed = parseBackupV3(JSON.stringify(exported))
    expect(parsed.timeEntries).toEqual([timeEntry])
    await importBackup(parsed)
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.settings.dailyMinutes).toBe(20)
    expect(snapshot.timeEntries).toEqual([timeEntry])
    expect(snapshot.attempts).toEqual([evidence])
    expect(snapshot.tracks).toContainEqual(track({ reps: 12, stability: 40 }))
  })

  it('imports V1 and V2 settings from coreMinutes and leaves legacy evidence unknown', async () => {
    const { dailyMinutes: _dailyMinutes, ...legacySettings } = DEFAULT_SETTINGS
    const legacy = { ...backupV1(), settings: { ...legacySettings, coreMinutes: 20, extensionMinutes: 35 } }
    await importBackup(legacy)
    expect((await getUserDataSnapshot()).settings.dailyMinutes).toBe(20)
    expect((await getUserDataSnapshot()).timeEntries).toEqual([])
    expect(await getAllReviewAttempts()).toEqual([attempt()])
    const exported = await exportBackup()
    const { timeEntries: _timeEntries, ...base } = exported
    await importBackup({ ...base, version: 2, settings: legacy.settings })
    expect((await getUserDataSnapshot()).settings.dailyMinutes).toBe(20)
    expect((await getUserDataSnapshot()).timeEntries).toEqual([])
  })

  it.each([
    ['invalid time', (backup: BackupV3) => ({ ...backup, timeEntries: [{ ...backup.timeEntries[0], activeMs: -1 }] })],
    ['invalid local date', (backup: BackupV3) => ({ ...backup, timeEntries: [{ ...backup.timeEntries[0], localDate: '2026-02-30' }] })],
    ['duplicate session day', (backup: BackupV3) => ({ ...backup, timeEntries: [...backup.timeEntries, { ...backup.timeEntries[0], id: 'duplicate' }] })],
    ['unknown evidence source', (backup: BackupV3) => ({ ...backup, attempts: [{ ...backup.attempts[0], evaluationSource: 'maybe' }] })],
    ['partial evidence', (backup: BackupV3) => ({ ...backup, attempts: [{ ...backup.attempts[0], evidenceVersion: 1 }] })],
    ['invalid new quota', (backup: BackupV3) => ({ ...backup, settings: { ...backup.settings, newItemsPerDay: 101 } })],
    ['fractional budget', (backup: BackupV3) => ({ ...backup, settings: { ...backup.settings, dailyMinutes: 15.5 } })],
  ])('rejects %s atomically', async (_name, mutate) => {
    await writeBatch({
      words: [word()], lists: ALL_VOCABULARY_LISTS, tracks: [track()], attempts: [attempt()],
      timeEntries: [{ id: 'session-1:2026-08-10', sessionId: 'session-1', localDate: '2026-08-10', activeMs: 5_000, updatedAt: newer }],
    })
    const exported = await exportBackup()
    const before = await getUserDataSnapshot()
    await expect(importBackup(mutate(exported))).rejects.toThrow(BackupValidationError)
    expect(await getUserDataSnapshot()).toEqual(before)
  })

  it('strictly rejects unknown or malformed fields before replacing stored data', async () => {
    await writeBatch({
      words: [word({ expression: 'keep me' })],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
    })
    const malformed = {
      ...backupV1(),
      tracks: [track({ itemId: 'missing-vocabulary' })],
      unexpected: true,
    }

    expect(() => parseBackup(JSON.stringify(malformed))).toThrow(BackupValidationError)
    await expect(importBackup(malformed)).rejects.toThrow('$.unexpected')
    expect(await getAllVocabulary()).toEqual([
      expect.objectContaining({ expression: 'keep me' }),
    ])
  })

  it('rejects malformed V2 backups before replacing stored data', async () => {
    await writeBatch({
      words: [word({ expression: 'keep me v2' })],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
    })

    const exported = await exportBackup()
    const { timeEntries: _timeEntries, ...v2Base } = exported
    const malformedV2 = {
      ...v2Base,
      version: 2,
      memberships: [{
        ...exported.memberships[0],
        wordId: 'missing-word',
      }],
    }

    expect(() => parseBackupV2(JSON.stringify(malformedV2))).toThrow(BackupValidationError)
    await expect(importBackup(malformedV2)).rejects.toThrow('引用了不存在的词条')
    expect(await getAllVocabulary()).toEqual([
      expect.objectContaining({ expression: 'keep me v2' }),
    ])
  })

  it('deduplicates the same sense while preserving different senses of one word', async () => {
    const duplicateVocabulary = {
      ...word(),
      id: 'vocabulary-duplicate',
      expression: ' Asset ',
      senseKey: 'FINANCE-NOUN-RESOURCE',
      zhGloss: '资产（更新）',
      updatedAt: newer,
      category: 'finance' as const,
    }
    const otherSense = {
      ...word(),
      id: 'vocabulary-other-sense',
      expression: 'asset',
      senseKey: 'useful-person-or-quality',
      zhGloss: '有用的人或品质',
      category: 'finance' as const,
    }
    const duplicateTrack = track({
      id: 'track-duplicate',
      itemId: 'vocabulary-duplicate',
    })
    const otherTrack = track({
      id: 'track-other',
      itemId: 'vocabulary-other-sense',
    })
    const duplicateAttempt = attempt({
      id: 'attempt-duplicate',
      trackId: 'track-duplicate',
      itemId: 'vocabulary-duplicate',
    })
    const otherAttempt = attempt({
      id: 'attempt-other',
      trackId: 'track-other',
      itemId: 'vocabulary-other-sense',
    })

    const summary = await importBackup(backupV1({
      vocabulary: [
        { ...word(), category: 'finance' },
        duplicateVocabulary,
        otherSense,
      ],
      tracks: [track(), duplicateTrack, otherTrack],
      attempts: [attempt(), duplicateAttempt, otherAttempt],
    }))

    expect(summary.vocabulary).toBe(2)
    expect(summary.tracks).toBe(4)
    expect(summary.duplicatesRemoved.vocabulary).toBe(1)
    expect(summary.duplicatesRemoved.tracks).toBe(1)
    expect(await getAllVocabulary()).toEqual([
      expect.objectContaining({
        id: 'vocabulary-1',
        zhGloss: '资产（更新）',
      }),
      expect.objectContaining({
        id: 'vocabulary-other-sense',
        zhGloss: '有用的人或品质',
      }),
    ])
    expect(await getAllLearningTracks()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'track-1', itemId: 'vocabulary-1', type: 'receptive' }),
      expect.objectContaining({ itemId: 'vocabulary-1', type: 'productive' }),
      expect.objectContaining({ id: 'track-other', itemId: 'vocabulary-other-sense', type: 'receptive' }),
      expect.objectContaining({ itemId: 'vocabulary-other-sense', type: 'productive' }),
    ]))
    expect((await getAllLearningTracks())).toHaveLength(4)
    expect(await getAllReviewAttempts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: 'vocabulary-1' }),
        expect.objectContaining({ itemId: 'vocabulary-other-sense' }),
      ]),
    )
  })

  it('fills missing core tracks so imported words remain learnable', async () => {
    const summary = await importBackup({
      version: 2,
      exportedAt: newer,
      words: [word()],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-accounting',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.accounting,
        priority: 1,
        sortOrder: 0,
      }],
      tracks: [],
      attempts: [],
      settings: DEFAULT_SETTINGS,
    })

    expect(summary.tracks).toBe(2)
    const tracks = await getAllLearningTracks()
    expect(tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'vocabulary-1', type: 'receptive', unlocked: true }),
      expect.objectContaining({ itemId: 'vocabulary-1', type: 'productive', unlocked: true }),
    ]))
  })

  it('rejects V2 backups with duplicate list or membership ids', async () => {
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
      settings: DEFAULT_SETTINGS,
    })
    const exported = await exportBackup()
    const duplicateListId = {
      ...exported,
      lists: [
        ...exported.lists,
        { ...exported.lists[0], name: 'Dup' },
      ],
    }
    await expect(importBackup(duplicateListId)).rejects.toThrow(/词表 ID/)

    const otherList = exported.lists.find((list) => list.id !== exported.memberships[0].listId)
    expect(otherList).toBeDefined()
    const duplicateMembershipId = {
      ...exported,
      memberships: [
        exported.memberships[0],
        {
          ...exported.memberships[0],
          listId: otherList!.id,
        },
      ],
    }
    await expect(importBackup(duplicateMembershipId)).rejects.toThrow(/列表关联 ID/)
  })
})
