import { afterEach, expect, it } from 'vitest'
import pack from '../../data/shared-power-bank/shared-power-bank.vocabulary.json'
import pasteText from '../../data/shared-power-bank/vocabulary.tsv?raw'
import { clearDatabase, closeDatabase, getUserDataSnapshot, putWord } from './db'
import { importVocabularyPack, parseVocabularyPack } from './vocabularyPack'
import { parseVocabularyImport } from './vocabularyImport'

afterEach(closeDatabase)

it('teaches device placement agreement and keeps an older saved copy under the same ID on reimport', async () => {
  const id = 'shared-power-bank-placement-agreement'
  const word = parseVocabularyPack(pack).words.find((entry) => entry.id === id)!
  expect(word.expression).toBe('device placement agreement')
  expect(word.acceptedEnVariants).toEqual(['device placement agreement', 'equipment placement agreement'])
  expect(word.usagePrompts.find(prompt => prompt.type === 'cloze')?.answer).toBe(word.expression)

  await clearDatabase()
  await putWord({ ...word, expression: 'placement agreement', lemma: 'placement agreement', zhGloss: '我的工作译法', contentEdited: true })
  const result = await importVocabularyPack(pack)
  const { words } = await getUserDataSnapshot()
  expect(result.added).toBe(41)
  expect(words.filter(entry => entry.senseKey === word.senseKey)).toHaveLength(1)
  expect(words.find(entry => entry.id === id)?.zhGloss).toBe('我的工作译法')
})

it('provides a valid work-specific pack with matching paste content and preserves progress on repeat imports', async () => {
  const validated = parseVocabularyPack(pack)
  const paste = parseVocabularyImport(pasteText)
  expect(paste.errors).toEqual([])
  expect(validated.words).toHaveLength(42)
  expect(paste.rows.map((row) => row.expression).sort()).toEqual(validated.words.map((word) => word.expression).sort())
  expect(validated.words.every((word) => word.enDefinition && word.examples[0]?.en && word.examples[0]?.zh)).toBe(true)
  expect(new Set(paste.rows.map((row) => row.category))).toEqual(new Set(['business', 'daily', 'finance', 'accounting']))
  await clearDatabase()
  expect((await importVocabularyPack(pack)).added).toBe(42)
  const before = await getUserDataSnapshot()
  const word = before.words[0]
  await putWord({ ...word, knownAt: '2026-10-11T01:00:00Z', vocabularyLevel: 'C1' })
  expect((await importVocabularyPack(pack)).added).toBe(0)
  const after = await getUserDataSnapshot()
  expect(after.words.find((item) => item.id === word.id)).toMatchObject({ knownAt: '2026-10-11T01:00:00Z', vocabularyLevel: 'C1' })
  expect(after.tracks).toEqual(before.tracks)
})
