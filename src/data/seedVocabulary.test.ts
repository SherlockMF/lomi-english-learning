import { describe, expect, it } from 'vitest'

import type { Word } from '../domain/types'
import { listSlugsForFormerFinance } from './listAssignment'
import { handcraftedSeedWords, loadSeedPack } from './seedVocabulary'
import { ALL_VOCABULARY_LISTS, LIST_IDS } from './vocabularyLists'

const bundled = await loadSeedPack()
const bundledSeedWords = bundled.words.slice(handcraftedSeedWords.length)
const seedWords = bundled.words
const seedMemberships = bundled.memberships

function expectText(value: string): void {
  expect(typeof value).toBe('string')
  expect(value.trim().length).toBeGreaterThan(0)
}

function expectCompleteHandcraftedItem(item: Word): void {
  expectText(item.id)
  expectText(item.expression)
  expectText(item.lemma)
  expectText(item.senseKey)
  expectText(item.zhGloss)
  expectText(item.enDefinition)
  expectText(item.partOfSpeech)
  expect(item.source).toBe('seed')
  expect(item.status).toBe('active')
  expect(Number.isFinite(item.priority)).toBe(true)
  expect(item.priority).toBeGreaterThan(0)

  expect(item.acceptedZhAnswers.length).toBeGreaterThan(0)
  item.acceptedZhAnswers.forEach(expectText)
  expect(item.acceptedZhAnswers).toContain(item.zhGloss)

  expect(item.acceptedEnVariants.length).toBeGreaterThan(0)
  item.acceptedEnVariants.forEach(expectText)
  expect(item.acceptedEnVariants).toContain(item.expression)

  expect(item.examples).toHaveLength(2)
  item.examples.forEach((example) => {
    expectText(example.en)
    expectText(example.zh)
  })

  expect(item.collocations.length).toBeGreaterThanOrEqual(2)
  expect(item.collocations.length).toBeLessThanOrEqual(3)
  item.collocations.forEach(expectText)

  expect(item.usagePrompts.length).toBeGreaterThanOrEqual(2)
  expect(item.usagePrompts.map((prompt) => prompt.type)).toEqual(
    expect.arrayContaining(['cloze', 'sentence']),
  )
  item.usagePrompts.forEach((prompt) => {
    expectText(prompt.id)
    expectText(prompt.prompt)
    expectText(prompt.modelAnswer)
    expect(prompt.checkpoints.length).toBeGreaterThan(0)
    prompt.checkpoints.forEach(expectText)
    if (prompt.type === 'cloze') {
      expect(prompt.prompt).toContain('_____')
      expect(prompt.answer).toBe(item.expression)
    }
  })

  expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false)
  expect(Number.isNaN(Date.parse(item.updatedAt))).toBe(false)
}

describe('seedWords', () => {
  it('keeps historical handcrafted seed ids and merges bundled pack senses', () => {
    expect(handcraftedSeedWords).toHaveLength(240)
    expect(bundledSeedWords).toHaveLength(37222)
    expect(seedWords).toHaveLength(37462)
    expect(seedWords.some((item) => item.id === 'seed-daily-001')).toBe(true)
    expect(seedWords.some((item) => item.id === 'seed-finance-001')).toBe(true)
    expect(seedWords.some((item) => item.id === 'seed-business-001')).toBe(true)
    expect(seedWords.every((item) => item.source === 'seed')).toBe(true)
    expect(bundledSeedWords.every((item) => /^(v1|core|econ|v6)-/.test(item.id))).toBe(true)
    expect(seedWords.some((item) => item.id.startsWith('v1-'))).toBe(true)
    expect(seedWords.some((item) => item.expression === 'rape')).toBe(false)
    expect(seedWords.some((item) => /customary's/i.test(item.expression))).toBe(false)
    expect(
      bundledSeedWords.some(
        (item) => /^a\.\s/i.test(item.zhGloss) || item.acceptedZhAnswers.some((a) => /^a\.\s/i.test(a)),
      ),
    ).toBe(false)
    expect(bundledSeedWords.some((item) => /^\s*[navsr]\.\s/i.test(item.enDefinition))).toBe(false)
    expect(seedWords.find((item) => item.expression === 'bad debt')?.enDefinition).toMatch(
      /irrecoverable|written off/i,
    )
    expect(seedWords.find((item) => item.expression === 'share capital')?.enDefinition).toMatch(
      /no par value|Companies Act 2016/i,
    )
    expect(
      seedWords.some((item) =>
        /精液|迷幻药|花柳病/.test(`${item.zhGloss}|${(item.acceptedZhAnswers ?? []).join('|')}`),
      ),
    ).toBe(false)
  })

  it('splits former finance seed across finance and accounting lists', () => {
    const financeIds = new Set(
      seedMemberships
        .filter((item) => item.listId === LIST_IDS.finance)
        .map((item) => item.wordId),
    )
    const accountingIds = new Set(
      seedMemberships
        .filter((item) => item.listId === LIST_IDS.accounting)
        .map((item) => item.wordId),
    )
    expect(financeIds.size).toBeGreaterThan(0)
    expect(accountingIds.size).toBeGreaterThan(0)
    expect(listSlugsForFormerFinance('asset')).toEqual(['accounting'])
    expect(listSlugsForFormerFinance('bond')).toEqual(['finance'])
    expect(listSlugsForFormerFinance('equity')).toEqual(['finance', 'accounting'])
  })

  it('includes four system lists, the expansion categories, and personal my-vocabulary', () => {
    expect(ALL_VOCABULARY_LISTS.map((list) => list.slug)).toEqual([
      'daily',
      'business',
      'finance',
      'accounting',
      'campus',
      'housing',
      'health',
      'money',
      'career',
      'food',
      'travel',
      'government',
      'emergency',
      'shopping',
      'social',
      'entertainment',
      'digital',
      'communication',
      'cs',
      'economics',
      'math',
      'engineering',
      'medicine',
      'law',
      'psychology',
      'marketing',
      'my-vocabulary',
    ])
    expect(ALL_VOCABULARY_LISTS.find((list) => list.slug === 'my-vocabulary')?.isSystem).toBe(false)
  })

  it('uses unique ids, sense keys, and prompt ids', () => {
    const ids = seedWords.map((item) => item.id)
    const senseKeys = seedWords.map((item) => item.senseKey)
    const promptIds = seedWords.flatMap((item) => item.usagePrompts.map((prompt) => prompt.id))

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(senseKeys).size).toBe(senseKeys.length)
    expect(new Set(promptIds).size).toBe(promptIds.length)
  })

  it('provides complete review and usage content for every handcrafted item', () => {
    handcraftedSeedWords.forEach(expectCompleteHandcraftedItem)
  })

  it('gives bundled seed items usable prompts and memberships', () => {
    const membershipWordIds = new Set(seedMemberships.map((membership) => membership.wordId))
    for (const item of bundledSeedWords) {
      expect(item.source).toBe('seed')
      expect(item.examples.length).toBeGreaterThanOrEqual(1)
      expect(item.usagePrompts.length).toBeGreaterThanOrEqual(2)
      expect(membershipWordIds.has(item.id)).toBe(true)
    }
  })
})
