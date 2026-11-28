import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictionaryResult, VocabularyItem, Word } from '../domain/types'
import { clearDatabase, closeDatabase, getUserDataSnapshot, hydrateWord, initializeDatabase, writeBatch } from './db'
import { exportBackup, importBackup } from './backup'
import { createInitialTracks } from './scheduler'
import { applyBundledDictionarySenses, dictionarySenseKey, groupWordsByExpression, saveDictionarySenses } from './wordSenses'

const now = '2026-10-08T00:00:00.000Z'
const result: DictionaryResult = {
  query: 'interest', word: 'interest', fetchedAt: now,
  meanings: [
    { partOfSpeech: 'noun', zhGloss: '兴趣', definition: 'a desire to learn about something', example: 'She has an interest in art.', synonyms: [] },
    { partOfSpeech: 'noun', zhGloss: '利息', definition: 'money paid for borrowing money', example: 'The loan carries interest.', synonyms: [] },
    { partOfSpeech: 'verb', definition: 'to attract attention', synonyms: [] },
  ],
}

function oldWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'old-interest', expression: 'interest', lemma: 'interest', senseKey: 'finance:interest',
    zhGloss: '利息', enDefinition: 'my verified definition', partOfSpeech: 'noun',
    acceptedZhAnswers: ['利息'], acceptedEnVariants: ['interest'], examples: [], collocations: [],
    source: 'custom', priority: 7, status: 'active', vocabularyLevel: 'B2', knownAt: now,
    usagePrompts: [], createdAt: now, updatedAt: now, ...overrides,
  }
}

describe('word senses', () => {
  beforeEach(async () => { await clearDatabase(); await initializeDatabase() })
  afterEach(async () => { await closeDatabase() })

  it('reports an interrupted sense write without replaying it or committing any of its stores', async () => {
    const put = IDBObjectStore.prototype.put
    let aborted = false
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args)
      if (!aborted && this.name === 'words') {
        aborted = true
        queueMicrotask(() => this.transaction.abort())
      }
      return request
    })
    try {
      await expect(saveDictionarySenses(result, [0], 'auto')).rejects.toMatchObject({ name: 'AbortError' })
      const snapshot = await getUserDataSnapshot()
      expect([snapshot.words, snapshot.memberships, snapshot.tracks]).toEqual([[], [], []])
    } finally { fault.mockRestore() }
  })

  it('uses the same source sense after an English definition is added, retaining its ID and progress', async () => {
    const initial = { ...result, meanings: [{ ...result.meanings[0], definition: '', example: undefined }] }
    await saveDictionarySenses(initial, [], 'daily')
    const before = await getUserDataSnapshot()
    const tracks = before.tracks.map((track) => ({ ...track, reps: 7, stability: 12 }))
    await writeBatch({ tracks })
    const meaning = { ...result.meanings[0], senseKey: 'dictionary:youdao:["noun","兴趣",0]' }
    await saveDictionarySenses({ ...result, meanings: [meaning] }, [], 'daily')
    const after = await getUserDataSnapshot()
    expect(after.words).toHaveLength(1)
    expect(after.words[0]).toMatchObject({ id: before.words[0].id, enDefinition: meaning.definition, senseKey: meaning.senseKey })
    expect(after.tracks).toEqual(expect.arrayContaining(tracks))
    await saveDictionarySenses({ ...result, meanings: [{ ...meaning, definition: 'a richer source definition' }] }, [], 'daily')
    expect((await getUserDataSnapshot()).words).toHaveLength(1)
  })

  it('migrates identical blank provider senses without creating another learning record', async () => {
    const blank = { ...result.meanings[0], definition: '', example: undefined }
    await saveDictionarySenses({ ...result, meanings: [blank] }, [], 'daily')
    const before = await getUserDataSnapshot()
    const meanings = [0, 1].map((ordinal) => ({ ...blank, senseKey: `dictionary:youdao:["noun","兴趣",${ordinal}]` }))
    await saveDictionarySenses({ ...result, meanings }, [], 'daily')
    const after = await getUserDataSnapshot()
    expect(after.words).toHaveLength(1)
    expect(after.words[0].id).toBe(before.words[0].id)
    expect(after.tracks).toEqual(before.tracks)
  })

  it('withdraws an exact incorrect automated definition without changing edits or progress', async () => {
    const meaning = { ...result.meanings[0], definition: 'incorrect automated source', senseKey: 'dictionary:youdao:["noun","兴趣",0]' }
    await saveDictionarySenses({ ...result, meanings: [meaning] }, [], 'daily')
    const before = await getUserDataSnapshot()
    const tracks = before.tracks.map((track) => ({ ...track, reps: 4 }))
    await writeBatch({ tracks })
    const corrected = { ...meaning, definition: '', example: undefined, supersededDefinition: meaning.definition }
    await saveDictionarySenses({ ...result, meanings: [corrected] }, [], 'daily')
    const after = await getUserDataSnapshot()
    expect(after.words[0]).toMatchObject({ id: before.words[0].id, enDefinition: '', status: 'paused' })
    expect(after.tracks).toEqual(tracks)
    const edited = { ...after.words[0], enDefinition: 'user verified definition' }
    await writeBatch({ words: [edited] })
    await saveDictionarySenses({ ...result, meanings: [corrected] }, [], 'daily')
    expect((await getUserDataSnapshot()).words[0]).toEqual(edited)
  })

  it('serializes manual completion across independent browser contexts', async () => {
    vi.resetModules()
    const separate = await import('./wordSenses')
    const separateDb = await import('./db')
    try {
      await Promise.all([saveDictionarySenses(result, [], 'daily'), separate.saveDictionarySenses(result, [], 'daily')])
      const after = await getUserDataSnapshot()
      expect(after.words).toHaveLength(3)
      expect(new Set(after.words.map((word) => word.senseKey)).size).toBe(3)
    } finally { await separateDb.closeDatabase() }
  })

  it('recognizes the original provider identity even after the learner edits its gloss and POS', async () => {
    await saveDictionarySenses({ ...result, meanings: [result.meanings[0]] }, [], 'daily')
    const before = await getUserDataSnapshot()
    const edited = { ...before.words[0], zhGloss: '自己的解释', partOfSpeech: 'expression', enDefinition: 'my edited definition', knownAt: now }
    await writeBatch({ words: [edited] })
    const meaning = { ...result.meanings[0], senseKey: 'dictionary:youdao:["noun","兴趣",0]' }
    await saveDictionarySenses({ ...result, meanings: [meaning] }, [], 'daily')
    const after = await getUserDataSnapshot()
    expect(after.words).toHaveLength(1)
    expect(after.words[0]).toMatchObject({ id: edited.id, zhGloss: edited.zhGloss, partOfSpeech: edited.partOfSpeech,
      enDefinition: edited.enDefinition, knownAt: now, senseKey: meaning.senseKey })
  })

  it('does not duplicate senses when manual completion and the bundled merge run together', async () => {
    await writeBatch({ words: [oldWord()], memberships: [{ id: 'base-finance', wordId: 'old-interest', listId: 'list-finance', priority: 7, sortOrder: 0 }] })
    vi.resetModules()
    const separate = await import('./wordSenses')
    const separateDb = await import('./db')
    try {
      await Promise.all([saveDictionarySenses(result, [], 'finance'),
        separate.applyBundledDictionarySenses({ revision: 'manual-and-bundled', results: [result] })])
      expect((await getUserDataSnapshot()).words).toHaveLength(3)
    } finally { await separateDb.closeDatabase() }
  })

  it('persists explicit edits to an existing dictionary sense without resetting its identity or progress', async () => {
    await saveDictionarySenses(result, [], 'auto')
    const before = await getUserDataSnapshot()
    const original = before.words.find((word) => word.zhGloss === '兴趣')!
    const edited = { ...result, meanings: result.meanings.map((meaning, index) => index === 0 ? {
      ...meaning, senseKey: dictionarySenseKey(meaning), zhGloss: '感兴趣', definition: 'edited definition',
      partOfSpeech: 'verb', example: 'Art interests me.', exampleZh: '艺术使我感兴趣。', collocations: ['interest someone'],
    } : meaning) }
    await saveDictionarySenses(edited, [], 'auto', undefined, {
      edits: [{ senseKey: dictionarySenseKey(result.meanings[0]), original: result.meanings[0] }],
    })
    const saved = await getUserDataSnapshot()
    expect(saved.words).toHaveLength(before.words.length)
    expect(saved.words.find((word) => word.id === original.id)).toMatchObject({
      senseKey: original.senseKey, createdAt: original.createdAt, zhGloss: '感兴趣', partOfSpeech: 'verb',
      enDefinition: 'edited definition', examples: [{ en: 'Art interests me.', zh: '艺术使我感兴趣。' }],
      collocations: ['interest someone'], status: 'paused', acceptedZhAnswers: ['感兴趣'],
    })
    expect(saved.tracks).toEqual(before.tracks)
    expect(saved.words.find((word) => word.id === original.id)?.usagePrompts[1].prompt).toContain('感兴趣')
    await saveDictionarySenses(result, [], 'auto')
    expect((await getUserDataSnapshot()).words).toEqual(saved.words)
  })

  it('matches an explicitly edited legacy sense using its original content and permits clearing optional fields', async () => {
    const source = { ...result, meanings: result.meanings.map((meaning, index) => index === 1
      ? { ...meaning, example: 'Old example', exampleZh: '旧例句', collocations: ['old collocation'] } : meaning) }
    const word = oldWord({ enDefinition: result.meanings[1].definition,
      examples: [{ en: 'Old example', zh: '旧例句' }], collocations: ['old collocation'] })
    await writeBatch({ words: [word], tracks: createInitialTracks([word]) })
    const edited = { ...source, meanings: source.meanings.map((meaning, index) => index === 1 ? {
      ...meaning, senseKey: dictionarySenseKey(meaning), zhGloss: '借款利息', definition: 'edited finance sense',
      example: undefined, exampleZh: undefined, collocations: [],
    } : meaning) }
    await saveDictionarySenses(edited, [], 'auto', undefined, {
      edits: [{ senseKey: dictionarySenseKey(source.meanings[1]), original: source.meanings[1] }],
    })
    const saved = await getUserDataSnapshot()
    expect(saved.words.find((item) => item.id === word.id)).toMatchObject({ zhGloss: '借款利息',
      enDefinition: 'edited finance sense', examples: [], collocations: [], knownAt: word.knownAt, vocabularyLevel: 'B2' })
    expect(saved.words.filter((item) => item.zhGloss === '借款利息')).toHaveLength(1)
  })

  it('changes only explicitly edited fields and preserves personal content not shown by the dictionary', async () => {
    await saveDictionarySenses(result, [], 'auto')
    const before = await getUserDataSnapshot()
    const original = before.words.find((word) => word.zhGloss === '兴趣')!
    const personal = { ...original, enDefinition: 'my personal definition',
      examples: [{ en: 'My personal example.', zh: '个人例句。' }], collocations: ['personal collocation'],
      usagePrompts: [{ id: 'personal-prompt', type: 'sentence' as const, prompt: 'Personal task', modelAnswer: 'Personal answer', checkpoints: [] }] }
    await writeBatch({ words: [personal] })
    const edited = { ...result, meanings: result.meanings.map((meaning, index) => index === 0
      ? { ...meaning, senseKey: dictionarySenseKey(meaning), zhGloss: '个人兴趣' } : meaning) }
    await saveDictionarySenses(edited, [], 'auto', undefined, {
      edits: [{ senseKey: dictionarySenseKey(result.meanings[0]), original: result.meanings[0] }],
    })
    const saved = (await getUserDataSnapshot()).words.find((word) => word.id === personal.id)!
    expect(saved).toMatchObject({ zhGloss: '个人兴趣', enDefinition: personal.enDefinition,
      examples: personal.examples, collocations: personal.collocations, usagePrompts: personal.usagePrompts })
  })

  it('applies a bundled revision once, preserving edited content and all old progress', async () => {
    const word = oldWord({ status: 'paused' })
    const tracks = createInitialTracks([word]).map((track) => ({ ...track, reps: 8, stability: 9 }))
    await writeBatch({ words: [word], tracks, memberships: [{ id: 'old-finance', wordId: word.id, listId: 'list-finance', priority: 7, sortOrder: 0 }] })
    const pack = { revision: 'test-senses-1', results: [result, { ...result, query: 'deleted', word: 'deleted' }] }
    const applied = await applyBundledDictionarySenses(pack)
    const after = await getUserDataSnapshot()
    expect(applied.added).toBe(2)
    expect(after.words).toHaveLength(3)
    expect(after.words.find((item) => item.id === word.id)).toEqual(word)
    expect(after.words.every((item) => item.status === 'paused')).toBe(true)
    expect(after.tracks.filter((track) => track.itemId === word.id)).toEqual(expect.arrayContaining(tracks))
    expect(after.vocabulary.find((item) => item.zhGloss === '兴趣')?.listSlugs).toEqual(['finance'])
    expect(after.settings.dictionaryContentRevision).toBe(pack.revision)
    expect((await applyBundledDictionarySenses(pack)).added).toBe(0)
    expect((await getUserDataSnapshot()).words).toEqual(after.words)
    await saveDictionarySenses(result, [], 'finance')
    expect((await getUserDataSnapshot()).words).toHaveLength(3)
    const exported = await exportBackup()
    await importBackup(exported)
    expect((await getUserDataSnapshot()).settings.dictionaryContentRevision).toBe(pack.revision)
  })

  it('keeps custom scene notes when applying a bundled meaning', async () => {
    const word = oldWord()
    await writeBatch({ words: [word], memberships: [{ id: 'my-note', wordId: word.id, listId: 'list-my-vocabulary', priority: 7, sortOrder: 0, subcategory: '论文阅读' }] })
    await applyBundledDictionarySenses({ revision: 'test-custom', results: [result] })
    const newMeaning = (await getUserDataSnapshot()).vocabulary.find((item) => item.zhGloss === '兴趣')
    expect(newMeaning?.scenarioNote).toBe('论文阅读')
    expect(newMeaning?.listSlugs).toEqual(['my-vocabulary'])
  })

  it('does not duplicate a bundle when two browser contexts start together', async () => {
    await writeBatch({ words: [oldWord()], memberships: [{ id: 'base-finance', wordId: 'old-interest', listId: 'list-finance', priority: 7, sortOrder: 0 }] })
    vi.resetModules()
    const separate = await import('./wordSenses')
    const separateDb = await import('./db')
    try {
      const pack = { revision: 'concurrent-start', results: [result] }
      await Promise.all([applyBundledDictionarySenses(pack), separate.applyBundledDictionarySenses(pack)])
      expect((await getUserDataSnapshot()).words).toHaveLength(3)
    } finally { await separateDb.closeDatabase() }
  })

  it('repairs an affected bundle without deleting old, edited or reviewed records', async () => {
    await saveDictionarySenses({ ...result, meanings: [result.meanings[0]] }, [], 'daily')
    const initial = await getUserDataSnapshot()
    const original = { ...initial.words[0], createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }
    const duplicate = { ...initial.words[0], id: 'raced-duplicate', createdAt: '2026-10-11T02:00:00Z', updatedAt: '2026-10-11T02:00:00Z' }
    const edited = { ...duplicate, id: 'edited-duplicate', enDefinition: 'User edited source content' }
    await writeBatch({ words: [original, duplicate, edited], tracks: createInitialTracks([duplicate, edited]),
      memberships: [duplicate, edited].map((word) => ({ ...initial.memberships[0], id: `membership-${word.id}`, wordId: word.id })),
      settings: { ...initial.settings, dictionaryContentRevision: 'baca46435dadeabc' } })
    await applyBundledDictionarySenses({ revision: 'repaired-import', results: [result] })
    const after = await getUserDataSnapshot()
    expect(after.words.find((word) => word.id === original.id)).toEqual(original)
    expect(after.words.find((word) => word.id === edited.id)).toEqual(edited)
    expect(after.words.some((word) => word.id === duplicate.id)).toBe(false)
    expect(after.tracks.some((track) => track.itemId === duplicate.id)).toBe(false)
    expect(after.memberships.some((membership) => membership.wordId === duplicate.id)).toBe(false)
  })

  it('repairs old import duplicates before migrating to enriched provider identities', async () => {
    await saveDictionarySenses({ ...result, meanings: [result.meanings[0]] }, [], 'daily')
    const initial = await getUserDataSnapshot()
    const original = { ...initial.words[0], createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }
    const duplicate = { ...original, id: 'legacy-raced-duplicate', createdAt: '2026-10-11T02:00:00Z', updatedAt: '2026-10-11T02:00:00Z' }
    await writeBatch({ words: [original, duplicate], tracks: createInitialTracks([duplicate]),
      memberships: [{ ...initial.memberships[0], id: 'legacy-raced-membership', wordId: duplicate.id }],
      settings: { ...initial.settings, dictionaryContentRevision: 'baca46435dadeabc' } })
    const meaning = { ...result.meanings[0], definition: 'enriched source definition', senseKey: 'dictionary:youdao:["noun","兴趣",0]' }
    await applyBundledDictionarySenses({ revision: 'provider-identities', results: [{ ...result, meanings: [meaning] }] })
    const after = await getUserDataSnapshot()
    expect(after.words).toHaveLength(1)
    expect(after.words[0]).toMatchObject({ id: original.id, enDefinition: original.enDefinition, senseKey: meaning.senseKey })
    expect(after.tracks.some((track) => track.itemId === duplicate.id)).toBe(false)
    expect(after.memberships.some((membership) => membership.wordId === duplicate.id)).toBe(false)
  })

  it('fills incomplete dictionary content without persisting hydrated presentation fields', async () => {
    const initial = { ...result, meanings: [{ ...result.meanings[0], definition: '', example: undefined }] }
    await saveDictionarySenses(initial, [], 'daily')
    const before = await getUserDataSnapshot()
    await applyBundledDictionarySenses({ revision: 'fill-source', results: [{ ...result, meanings: [
      { ...result.meanings[0], senseKey: before.words[0].senseKey },
    ] }] })
    const after = await getUserDataSnapshot()
    expect(after.words[0].id).toBe(before.words[0].id)
    expect(after.words[0].enDefinition).toBe(result.meanings[0].definition)
    expect(after.words[0]).not.toHaveProperty('listSlugs')
    await expect(importBackup(await exportBackup())).resolves.toBeDefined()
  })

  it('groups identical expressions without conflating phrases, punctuation or records', () => {
    const words = ['interest', ' Interest ', 'interest rate', 're-sign', 'resign'].map((expression, index) =>
      hydrateWord(oldWord({ id: String(index), expression }), ['daily']))
    const groups = groupWordsByExpression(words)
    expect(groups).toHaveLength(4)
    expect(groups[0].senses.map((sense: VocabularyItem) => sense.id)).toEqual(['0', '1'])
    expect(words).toHaveLength(5)
  })

  it('archives all meanings while only selected bilingual senses enter training', async () => {
    await saveDictionarySenses(result, [1], 'finance')
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words).toHaveLength(3)
    expect(snapshot.words.find((word) => word.zhGloss === '利息')?.status).toBe('active')
    expect(snapshot.words.filter((word) => word.status === 'paused')).toHaveLength(2)
    expect(snapshot.vocabulary.find((word) => word.zhGloss === '兴趣')?.listSlugs).toEqual(['finance'])
    expect(snapshot.vocabulary.find((word) => word.zhGloss === '利息')?.listSlugs).toContain('my-vocabulary')
    expect(new Set(snapshot.tracks.map((track) => track.itemId)).size).toBe(3)
    expect(snapshot.attempts).toEqual([])
  })

  it('does not activate a meaning without a Chinese gloss', async () => {
    await saveDictionarySenses(result, [2], 'daily')
    expect((await getUserDataSnapshot()).words.every((word) => word.status === 'paused')).toBe(true)
  })

  it('automatically classifies each sense and preserves existing classifications and known marks', async () => {
    const known = oldWord()
    const membership = { id: 'own-category', wordId: known.id, listId: 'list-business', priority: 0, sortOrder: 0 }
    await writeBatch({ words: [known], memberships: [membership], tracks: createInitialTracks([known]) })
    await saveDictionarySenses(result, [], 'auto')
    const saved = await getUserDataSnapshot()
    expect(saved.vocabulary.find((word) => word.zhGloss === '兴趣')?.listSlugs).toEqual(['daily'])
    expect(saved.words.find((word) => word.id === known.id)?.knownAt).toBe(now)
    expect(saved.memberships.filter((entry) => entry.wordId === known.id)).toEqual([membership])
  })

  it('does not restore a known or paused sense when the same rows are imported again', async () => {
    const known = oldWord()
    const membership = { id: 'own-category', wordId: known.id, listId: 'list-business', priority: 0, sortOrder: 0 }
    await writeBatch({ words: [known], memberships: [membership], tracks: createInitialTracks([known]) })
    await saveDictionarySenses(result, [1], 'finance', undefined, { preserveExistingTraining: true })
    const saved = await getUserDataSnapshot()
    expect(saved.words.find((word) => word.id === known.id)).toEqual(known)
    expect(saved.memberships.filter((entry) => entry.wordId === known.id)).toEqual([membership])
  })

  it('preserves existing content, IDs, known marks and review tracks on repeated completion', async () => {
    const word = oldWord()
    const tracks = createInitialTracks([word]).map((track) => ({ ...track, reps: 9, stability: 12 }))
    await writeBatch({ words: [word], tracks })
    await saveDictionarySenses(result, [], 'finance')
    await saveDictionarySenses(result, [], 'finance')
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words).toHaveLength(3)
    expect(snapshot.words.find((candidate) => candidate.id === word.id)).toEqual(word)
    expect(snapshot.tracks.filter((track) => track.itemId === word.id)).toEqual(expect.arrayContaining(tracks))
  })

  it('allows explicitly selecting a paused sense without resetting its track', async () => {
    const word = oldWord({ status: 'paused', knownAt: undefined })
    const tracks = createInitialTracks([word]).map((track) => ({ ...track, reps: 4 }))
    await writeBatch({ words: [word], tracks })
    await saveDictionarySenses(result, [1], 'finance')
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words.find((candidate) => candidate.id === word.id)?.status).toBe('active')
    expect(snapshot.tracks.filter((track) => track.itemId === word.id)).toEqual(expect.arrayContaining(tracks))
  })

  it('keeps archived senses and independent progress through a V3 backup round trip', async () => {
    await saveDictionarySenses(result, [0], 'daily')
    const before = await getUserDataSnapshot()
    const backup = await exportBackup()
    await importBackup(backup)
    const after = await getUserDataSnapshot()
    expect(after.words).toEqual(before.words)
    expect(after.tracks).toEqual(before.tracks)
  })

  it('recognizes an edited dictionary gloss on a later lookup without duplicating or overwriting it', async () => {
    const edited = { ...result, meanings: result.meanings.map((meaning, index) => index === 0
      ? { ...meaning, senseKey: dictionarySenseKey(meaning), zhGloss: '感兴趣', collocations: ['interest in art'] } : meaning) }
    await saveDictionarySenses(edited, [0], 'daily')
    await saveDictionarySenses(result, [], 'daily')
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words).toHaveLength(3)
    expect(snapshot.words.find((word) => word.zhGloss === '感兴趣')?.collocations).toEqual(['interest in art'])
  })

  it('preserves different definitions sharing a Chinese gloss and activates only the selected sense', async () => {
    const sharedGloss = { ...result, word: 'bank', meanings: [
      { partOfSpeech: 'noun', zhGloss: '银行', definition: 'a financial institution', synonyms: [] },
      { partOfSpeech: 'noun', zhGloss: '银行', definition: 'a building housing a financial institution', synonyms: [] },
    ] }
    await saveDictionarySenses(sharedGloss, [1], 'finance')
    await saveDictionarySenses(sharedGloss, [], 'finance')
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words).toHaveLength(2)
    expect(snapshot.words.find((word) => word.enDefinition === 'a financial institution')?.status).toBe('paused')
    expect(snapshot.words.find((word) => word.enDefinition === 'a building housing a financial institution')?.status).toBe('active')
  })

  it('fills a previously archived English-only sense without changing its ID or existing tracks', async () => {
    const englishOnly = { ...result, meanings: [result.meanings[2]] }
    await saveDictionarySenses(englishOnly, [], 'daily')
    const before = await getUserDataSnapshot()
    await saveDictionarySenses({ ...englishOnly, meanings: [{ ...englishOnly.meanings[0],
      senseKey: before.words[0].senseKey, zhGloss: '引起兴趣', example: 'The topic interests me.' }] }, [0], 'daily')
    const after = await getUserDataSnapshot()
    expect(after.words).toHaveLength(1)
    expect(after.words[0]).toMatchObject({ id: before.words[0].id, zhGloss: '引起兴趣', status: 'active' })
    expect(after.tracks).toEqual(expect.arrayContaining(before.tracks))
    expect(after.tracks.some((track) => track.type === 'usage')).toBe(true)
    await saveDictionarySenses({ ...englishOnly, meanings: [{ ...englishOnly.meanings[0], zhGloss: '引起兴趣' }] }, [], 'daily')
    expect((await getUserDataSnapshot()).words).toHaveLength(1)
  })

  it('matches a legacy record only once when source senses share a Chinese gloss', async () => {
    const legacy = oldWord({ expression: 'bank', zhGloss: '银行', acceptedZhAnswers: ['银行'] })
    await writeBatch({ words: [legacy], tracks: createInitialTracks([legacy]) })
    const source = { ...result, word: 'bank', meanings: [
      { partOfSpeech: 'noun', zhGloss: '银行', definition: 'a financial institution', synonyms: [] },
      { partOfSpeech: 'noun', zhGloss: '银行', definition: 'a building housing a financial institution', synonyms: [] },
    ] }
    await saveDictionarySenses(source, [], 'finance')
    await saveDictionarySenses(source, [], 'finance')
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words).toHaveLength(3)
    expect(snapshot.words.find((word) => word.id === legacy.id)).toEqual(legacy)
    expect(snapshot.words.some((word) => word.enDefinition === source.meanings[0].definition)).toBe(true)
    expect(snapshot.words.some((word) => word.enDefinition === source.meanings[1].definition)).toBe(true)
  })

  it('does not consume a legacy building sense when selecting the financial institution sense', async () => {
    const legacy = oldWord({ expression: 'bank', zhGloss: '银行', acceptedZhAnswers: ['银行'],
      enDefinition: 'a building housing a financial institution', status: 'paused' })
    await writeBatch({ words: [legacy], tracks: createInitialTracks([legacy]) })
    const source = { ...result, word: 'bank', meanings: [
      { partOfSpeech: 'noun', zhGloss: '银行', definition: 'a financial institution', synonyms: [] },
      { partOfSpeech: 'noun', zhGloss: '银行', definition: legacy.enDefinition, synonyms: [] },
    ] }
    await saveDictionarySenses(source, [0], 'finance')
    const snapshot = await getUserDataSnapshot()
    expect(snapshot.words).toHaveLength(2)
    expect(snapshot.words.find((word) => word.id === legacy.id)).toEqual(legacy)
    expect(snapshot.words.find((word) => word.enDefinition === source.meanings[0].definition)?.status).toBe('active')
  })
})
