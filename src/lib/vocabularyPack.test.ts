import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS,
  type ReviewAttempt,
  type VocabularyPackV1,
  type Word,
} from '../domain/types'
import { ALL_VOCABULARY_LISTS, LIST_IDS } from '../data/vocabularyLists'
import { BackupValidationError } from './backup'
import {
  DATABASE_NAME,
  closeDatabase,
  getAllLearningTracks,
  getAllReviewAttempts,
  getAllVocabulary,
  getAllWords,
  writeBatch,
} from './db'
import {
  exportVocabularyPack,
  importVocabularyPack,
  parseVocabularyPack,
} from './vocabularyPack'

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

function pack(overrides: Partial<VocabularyPackV1> = {}): VocabularyPackV1 {
  const seed = word()
  return {
    version: 1,
    kind: 'vocabulary-pack',
    exportedAt: newer,
    words: [seed],
    lists: ALL_VOCABULARY_LISTS,
    memberships: [{
      id: 'membership-vocabulary-1-finance',
      wordId: seed.id,
      listId: LIST_IDS.finance,
      priority: 1,
      sortOrder: 0,
    }],
    ...overrides,
  }
}

describe('vocabulary pack import and export', () => {
  beforeEach(async () => {
    await closeDatabase()
    await deleteDB(DATABASE_NAME)
  })

  afterEach(async () => {
    await closeDatabase()
    await deleteDB(DATABASE_NAME)
  })

  it('exports lexical overrides without personal known marks and does not import someone else’s known status', async () => {
    await writeBatch({ words: [word({ knownAt: newer, vocabularyLevel: 'C1' })], settings: DEFAULT_SETTINGS })
    const exported = await exportVocabularyPack()
    expect(exported.words[0].vocabularyLevel).toBe('C1')
    expect(exported.words[0].knownAt).toBeUndefined()
    await importVocabularyPack(pack({ words: [word({ id: 'new-word', senseKey: 'another-sense', knownAt: newer, vocabularyLevel: 'B2' })], memberships: [] }))
    const words = await getAllWords()
    expect(words.find((entry) => entry.id === 'new-word')).toMatchObject({ vocabularyLevel: 'B2' })
    expect(words.find((entry) => entry.id === 'new-word')?.knownAt).toBeUndefined()
    expect(words.find((entry) => entry.id === 'vocabulary-1')?.knownAt).toBe(newer)
  })

  it('exports seed and custom words without tracks or settings mutation', async () => {
    const custom = word({
      id: 'custom-1',
      expression: 'onboarding',
      lemma: 'onboarding',
      senseKey: 'custom-process',
      zhGloss: '入职引导',
      source: 'custom',
      updatedAt: newer,
    })
    await writeBatch({
      words: [word(), custom],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [
        {
          id: 'membership-vocabulary-1-finance',
          wordId: 'vocabulary-1',
          listId: LIST_IDS.finance,
          priority: 1,
          sortOrder: 0,
        },
        {
          id: 'membership-custom-1-my',
          wordId: 'custom-1',
          listId: LIST_IDS['my-vocabulary'],
          priority: 1,
          sortOrder: 1,
        },
      ],
      tracks: [{
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
      }],
      settings: DEFAULT_SETTINGS,
    })

    const exported = await exportVocabularyPack(new Date(newer))

    expect(exported).toMatchObject({
      version: 1,
      kind: 'vocabulary-pack',
      exportedAt: newer,
    })
    expect(exported.words.map((item) => item.source).sort()).toEqual(['custom', 'seed'])
    expect(exported).not.toHaveProperty('tracks')
    expect(exported).not.toHaveProperty('attempts')
    expect(exported).not.toHaveProperty('settings')
  })

  it('imports a new custom word and creates initial tracks', async () => {
    await writeBatch({
      words: [word()],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-finance',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.finance,
        priority: 1,
        sortOrder: 0,
      }],
      settings: DEFAULT_SETTINGS,
    })

    const custom = word({
      id: 'custom-new',
      expression: 'pitch deck',
      lemma: 'pitch deck',
      senseKey: 'custom-slides',
      zhGloss: '路演材料',
      source: 'custom',
      updatedAt: newer,
    })
    const summary = await importVocabularyPack(pack({
      words: [custom],
      memberships: [{
        id: 'membership-custom-new-my',
        wordId: 'custom-new',
        listId: LIST_IDS['my-vocabulary'],
        priority: 1,
        sortOrder: 0,
      }],
    }))

    expect(summary).toMatchObject({ added: 1, updated: 0, membershipsAdded: 1 })
    expect(await getAllWords()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-new', source: 'custom' }),
    ]))
    const tracks = await getAllLearningTracks()
    expect(tracks.filter((track) => track.itemId === 'custom-new').length).toBeGreaterThanOrEqual(2)
  })

  it.each(['cs', 'economics', 'math', 'engineering', 'medicine', 'law', 'psychology', 'marketing'])(
    'imports %s as an optional system list and keeps its subcategory on repeat import',
    async (slug) => {
      const incoming = {
        ...pack(),
        lists: [{
          id: `external-${slug}`,
          name: slug,
          slug,
          description: '',
          category: slug,
          isSystem: true,
          createdAt: older,
        }],
        memberships: [{
          id: `membership-${slug}`,
          wordId: 'vocabulary-1',
          listId: `external-${slug}`,
          subcategory: 'course-terminology',
          priority: 1,
          sortOrder: 0,
        }],
      }

      expect(await importVocabularyPack(incoming)).toEqual({ added: 1, updated: 0, unchanged: 0, membershipsAdded: 1 })
      expect(await importVocabularyPack(incoming)).toEqual({ added: 0, updated: 0, unchanged: 1, membershipsAdded: 0 })
      expect((await getAllVocabulary()).find((item) => item.id === 'vocabulary-1')?.listSlugs).toEqual([slug])
      expect((await exportVocabularyPack()).memberships).toEqual([
        expect.objectContaining({ listId: `list-${slug}`, subcategory: 'course-terminology' }),
      ])
      expect(DEFAULT_SETTINGS.activeCategories).not.toContain(slug)
    },
  )

  it('keeps local progress and wording when merging the same identity', async () => {
    const attempt: ReviewAttempt = {
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
    }
    await writeBatch({
      words: [word({
        enDefinition: '',
        examples: [],
      })],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-finance',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.finance,
        priority: 1,
        sortOrder: 0,
      }],
      tracks: [{
        id: 'track-1',
        itemId: 'vocabulary-1',
        type: 'receptive',
        due: older,
        stability: 2,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 3,
        reps: 2,
        lapses: 0,
        state: 2,
        unlocked: true,
        lastReview: newer,
      }],
      attempts: [attempt],
      settings: DEFAULT_SETTINGS,
    })

    const summary = await importVocabularyPack(pack({
      words: [word({
        zhGloss: '资产（更新）',
        enDefinition: 'A resource with economic value.',
        examples: [{ en: 'Current assets rose.', zh: '流动资产上升了。' }],
        updatedAt: newer,
      })],
    }))

    expect(summary.updated).toBe(1)
    expect(await getAllVocabulary()).toEqual([
      expect.objectContaining({
        id: 'vocabulary-1',
        zhGloss: '资产',
        enDefinition: 'A resource with economic value.',
        examples: [{ en: 'Current assets rose.', zh: '流动资产上升了。' }],
      }),
    ])
    expect(await getAllLearningTracks()).toEqual([
      expect.objectContaining({ id: 'track-1', reps: 2, stability: 2 }),
    ])
    expect(await getAllReviewAttempts()).toEqual([
      expect.objectContaining({ id: 'attempt-1' }),
    ])
  })

  it('does not overwrite non-empty local wording from a newer pack word', async () => {
    await writeBatch({
      words: [word({ zhGloss: '我的资产释义', updatedAt: older })],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [{
        id: 'membership-vocabulary-1-finance',
        wordId: 'vocabulary-1',
        listId: LIST_IDS.finance,
        priority: 1,
        sortOrder: 0,
      }],
      settings: DEFAULT_SETTINGS,
    })

    const summary = await importVocabularyPack(pack({
      words: [word({
        zhGloss: '资产（更新）',
        enDefinition: 'Pack definition that must not replace local text.',
        updatedAt: newer,
      })],
    }))

    expect(summary.updated).toBe(0)
    expect(summary.unchanged).toBe(1)
    expect(await getAllWords()).toEqual([
      expect.objectContaining({
        zhGloss: '我的资产释义',
        enDefinition: 'A resource with economic value.',
      }),
    ])
  })

  it('rejects missing kind and BackupV2 payloads', () => {
    expect(() => parseVocabularyPack({
      version: 1,
      exportedAt: newer,
      words: [],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [],
    })).toThrow(BackupValidationError)

    expect(() => parseVocabularyPack({
      version: 2,
      kind: 'vocabulary-pack',
      exportedAt: newer,
      words: [],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [],
    })).toThrow(/仅支持版本 1/)

    expect(() => parseVocabularyPack({
      version: 2,
      exportedAt: newer,
      words: [],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [],
      tracks: [],
      attempts: [],
      settings: DEFAULT_SETTINGS,
    })).toThrow(BackupValidationError)
  })

  it('strips top-level note metadata so Design-A packs remain importable', () => {
    const imported = parseVocabularyPack({
      version: 1,
      kind: 'vocabulary-pack',
      exportedAt: newer,
      note: 'human-readable only; must not block import',
      words: [word({ id: 'custom-1', expression: 'invoice', senseKey: 'custom-invoice' })],
      lists: ALL_VOCABULARY_LISTS,
      memberships: [],
    })
    expect(imported.words).toHaveLength(1)
    expect(imported).not.toHaveProperty('note')
  })
})
