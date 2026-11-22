import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearDatabase, closeDatabase, getUserDataSnapshot, initializeDatabase, writeBatch } from '../lib/db'
import { applyBundledDictionarySenses, expressionKey } from '../lib/wordSenses'
import { loadSeedPack } from './seedVocabulary'
import { loadBundledDictionarySenses } from './dictionarySenses'

const report = JSON.parse(readFileSync(resolve('data/dictionary-senses/report.json'), 'utf8'))
const additional: string[] = JSON.parse(readFileSync(resolve('data/dictionary-senses/additionalExpressions.json'), 'utf8'))

describe('full library dictionary coverage', () => {
  afterEach(async () => { await clearDatabase(); await closeDatabase() })

  it('accounts for every current expression with either dictionary senses or an explicit unresolved record', async () => {
    const seed = await loadSeedPack()
    const pack = await loadBundledDictionarySenses()
    const expected = new Set([...seed.words.map((word) => expressionKey(word.expression)), ...additional.map(expressionKey)])
    const processed = [...pack.results.map((result) => expressionKey(result.query)),
      ...report.unresolved.map((entry: { query: string }) => expressionKey(entry.query))]
    expect(processed.length).toBe(expected.size)
    expect(new Set(processed)).toEqual(expected)
    expect(report.found).toBe(pack.results.length)
    expect(report.sourceSenses).toBe(pack.results.reduce((sum, result) => sum + result.meanings.length, 0))
    expect(report.unresolved.some((entry: { status: string }) => entry.status === 'error')).toBe(false)
    for (const result of pack.results) {
      expect(expressionKey(result.word)).toBe(expressionKey(result.query))
      expect(result.meanings.every((meaning) => Boolean(meaning.zhGloss?.trim()))).toBe(true)
    }
  })

  it('merges the full dictionary asset while preserving the base vocabulary and its reviewed tracks', async () => {
    const seed = await loadSeedPack()
    await initializeDatabase(seed.words.filter(word => !word.id.startsWith('v6-')),
      seed.memberships.filter(item => !item.wordId.startsWith('v6-')))
    const initial = await getUserDataSnapshot()
    const original = initial.words.find((word) => word.expression === 'abandon')!
    const edited = { ...original, enDefinition: 'User edited definition', status: 'paused' as const, knownAt: '2026-10-11T00:00:00Z' }
    const reviewed = initial.tracks.filter((track) => track.itemId === original.id).map((track) => ({ ...track, reps: 9, stability: 12 }))
    await writeBatch({ words: [edited], tracks: reviewed })
    const before = await getUserDataSnapshot()
    const applied = await applyBundledDictionarySenses(await loadBundledDictionarySenses())
    const after = await getUserDataSnapshot()
    const originals = new Map(before.words.map((word) => [word.id, word]))
    const saved = new Map(after.words.map((word) => [word.id, word]))
    for (const [id, word] of originals) expect(saved.get(id)).toEqual(word)
    expect(after.words.length - before.words.length).toBe(applied.added)
    expect(applied.added).toBeGreaterThan(20_000)
    expect(after.words.filter((word) => !originals.has(word.id)).every((word) => word.status === 'paused')).toBe(true)
    expect(after.words.every((word) => !('category' in word) && !('listSlugs' in word))).toBe(true)
    expect(after.tracks.filter((track) => track.itemId === original.id)).toEqual(reviewed)
    expect(after.attempts).toEqual(before.attempts)
    expect((await applyBundledDictionarySenses(await loadBundledDictionarySenses())).added).toBe(0)
  }, 60_000)
})
