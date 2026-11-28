import { afterEach, expect, it } from 'vitest'
import { forceCloseDatabase } from 'fake-indexeddb'
import { openDB, unwrap } from 'idb'
import { DATABASE_NAME, DATABASE_VERSION, closeDatabase, getDatabase, getRawDatabase, patchWord, putSettings, recordReview, selectDatabaseAccount, setDatabaseTrackingEnabled, writeBatch } from '../db'
import { DEFAULT_SETTINGS, type ReviewAttempt, type Word } from '../../domain/types'
import { createInitialTracks } from '../scheduler'
import { applyCloudChanges, readCloudState } from './storage'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const word: Word = { id: 'custom-test', expression: 'hello', lemma: 'hello', senseKey: 'greeting', zhGloss: '你好', enDefinition: 'a greeting', partOfSpeech: 'interjection', acceptedZhAnswers: ['你好'], acceptedEnVariants: ['hello'], examples: [], collocations: [], source: 'custom', priority: 0, status: 'active', usagePrompts: [], createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z' }

afterEach(async () => {
  setDatabaseTrackingEnabled(false)
  await selectDatabaseAccount(null)
  await closeDatabase()
  for (const id of [accountA, accountB]) await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(`recall-english:${id}`)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

it('isolates account databases and atomically records writes and deletes in a persistent outbox', async () => {
  await selectDatabaseAccount(accountA)
  setDatabaseTrackingEnabled(true)
  await writeBatch({ words: [word] })
  let state = await readCloudState()
  expect(state.queue).toHaveLength(1)
  expect(state.queue[0]).toMatchObject({ collection: 'words', key: word.id, data: word, base: null })
  await closeDatabase()
  expect((await readCloudState()).queue).toHaveLength(1)
  await (await getDatabase()).delete('words', word.id)
  state = await readCloudState()
  expect(state.queue[0].data).toBeNull()
  await selectDatabaseAccount(accountB)
  setDatabaseTrackingEnabled(true)
  expect((await readCloudState()).queue).toHaveLength(0)
  expect(await (await getDatabase()).count('words')).toBe(0)
})

it('reopens an unexpectedly closed account connection for both writes and sync', async () => {
  await selectDatabaseAccount(accountA)
  setDatabaseTrackingEnabled(true)
  await writeBatch({ words: [word] })
  const previous = await getRawDatabase()
  const closed = new Promise<void>(resolve => previous.addEventListener('close', () => resolve(), { once: true }))
  // @ts-expect-error fake-indexeddb 6.2.5 types this argument as a constructor, but takes an instance.
  forceCloseDatabase(unwrap(previous))
  await closed
  await putSettings(DEFAULT_SETTINGS)
  expect(await (await getRawDatabase()).get('words', word.id)).toEqual(word)
  expect((await readCloudState()).queue.map(entry => entry.collection).sort()).toEqual(['settings', 'words'])
})

it('does not reconnect a pending write to the next account', async () => {
  await selectDatabaseAccount(accountA)
  const previous = await getRawDatabase()
  previous.close()
  const pending = writeBatch({ words: [word] })
  const switching = selectDatabaseAccount(accountB)
  const next = getRawDatabase()
  await Promise.all([expect(pending).rejects.toThrow(), switching])
  expect((await next).name).toBe(`recall-english:${accountB}`)
  expect(await (await getDatabase()).count('words')).toBe(0)
})

it('can open the next account even if opening the old one fails late', async () => {
  const newer = await openDB(`${DATABASE_NAME}:${accountA}`, DATABASE_VERSION + 1)
  newer.close()
  await selectDatabaseAccount(accountA)
  const old = getDatabase()
  const switching = selectDatabaseAccount(accountB)
  const next = getRawDatabase()
  await Promise.all([expect(old).rejects.toThrow(), switching])
  expect(await getRawDatabase()).toBe(await next)
  expect((await next).name).toBe(`${DATABASE_NAME}:${accountB}`)
})

it('does not enqueue initialization or remote application, and cannot acknowledge a newer edit', async () => {
  await selectDatabaseAccount(accountA)
  await putSettings(DEFAULT_SETTINGS)
  expect((await readCloudState()).queue).toHaveLength(0)
  setDatabaseTrackingEnabled(true)
  await putSettings({ ...DEFAULT_SETTINGS, newItemsPerDay: 7 })
  const entry = (await readCloudState()).queue[0]
  await putSettings({ ...DEFAULT_SETTINGS, newItemsPerDay: 9 })
  const acknowledged = { collection: 'settings' as const, id: 'primary', data: { ...DEFAULT_SETTINGS, newItemsPerDay: 7 }, revision: 1 }
  await applyCloudChanges([acknowledged], 1, new Map([[entry.id, { nonce: entry.nonce, localData: entry.data }]]))
  const state = await readCloudState()
  expect(state.queue).toHaveLength(1)
  expect(state.queue[0].base).toMatchObject({ newItemsPerDay: 7 })
  expect((await (await getDatabase()).get('settings', 'primary'))?.newItemsPerDay).toBe(9)
})

it('preserves a late local edit together with fields merged from another device at acknowledgement', async () => {
  await selectDatabaseAccount(accountA)
  await putSettings(DEFAULT_SETTINGS)
  setDatabaseTrackingEnabled(true)
  await putSettings({ ...DEFAULT_SETTINGS, newItemsPerDay: 7 })
  const sent = (await readCloudState()).queue[0]
  await putSettings({ ...DEFAULT_SETTINGS, newItemsPerDay: 9 })
  await applyCloudChanges([{ collection: 'settings', id: 'primary', data: { ...DEFAULT_SETTINGS, newItemsPerDay: 7, dailyMinutes: 25 }, revision: 1 }], 1, new Map([[sent.id, { nonce: sent.nonce, localData: sent.data }]]))
  const current = await (await getDatabase()).get('settings', 'primary')
  expect(current).toMatchObject({ newItemsPerDay: 9, dailyMinutes: 25 })
  expect((await readCloudState()).queue[0].data).toMatchObject({ newItemsPerDay: 9, dailyMinutes: 25 })
})

it('rolls back the outbox when the original transaction aborts', async () => {
  await selectDatabaseAccount(accountA)
  setDatabaseTrackingEnabled(true)
  const transaction = (await getDatabase()).transaction('words', 'readwrite')
  await transaction.store.put(word)
  transaction.abort()
  await expect(transaction.done).rejects.toThrow()
  expect((await readCloudState()).queue).toHaveLength(0)
})

it('stores the FSRS baseline and retention with each newly recorded review', async () => {
  await selectDatabaseAccount(accountA)
  const tracks = createInitialTracks([word], word.createdAt)
  await writeBatch({ words: [word], tracks })
  setDatabaseTrackingEnabled(true)
  const result = await recordReview({ trackId: tracks[0].id, rating: 'good', desiredRetention: 0.85, reviewedAt: new Date('2026-10-23T02:00:00Z'), attempt: { id: 'review-a', itemId: word.id, trackType: 'receptive', promptType: 'meaning', answer: '你好', hintLevel: 0, responseMs: 1000 } })
  expect(result.attempt).toMatchObject({ desiredRetention: 0.85, trackBefore: tracks[0] })
  const state = await readCloudState()
  expect(state.queue.find(entry => entry.collection === 'attempts')?.data).toMatchObject({ id: 'review-a', desiredRetention: 0.85 })
})

it('reconciles usage unlocking when successful directions arrive from different devices', async () => {
  await selectDatabaseAccount(accountA)
  const tracks = createInitialTracks([{ ...word, usagePrompts: [{ id: 'prompt', type: 'cloze', prompt: '...', modelAnswer: 'hello', checkpoints: ['hello'] }] }], word.createdAt)
  await writeBatch({ words: [word], tracks })
  setDatabaseTrackingEnabled(true)
  const review: ReviewAttempt = { id: 'recall-a', trackId: tracks[0].id, itemId: word.id, trackType: 'receptive', promptType: 'meaning', answer: '你好', rating: 'good', hintLevel: 0, responseMs: 1, reviewedAt: '2026-10-23T01:00:00Z', evidenceVersion: 1, retryCount: 0, sessionId: 'session', evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good' }
  await recordReview({ trackId: tracks[0].id, rating: 'good', desiredRetention: 0.9, attempt: review })
  await applyCloudChanges([{ collection: 'attempts', id: 'recall-b', data: { ...review, id: 'recall-b', trackId: tracks[1].id, trackType: 'productive' }, revision: 1 }], 1)
  expect((await (await getDatabase()).get('tracks', tracks[2].id))?.unlocked).toBe(true)
})

it('applies a personal status action to the latest word instead of replacing another tab edit', async () => {
  await selectDatabaseAccount(accountA)
  await writeBatch({ words: [word] })
  setDatabaseTrackingEnabled(true)
  await applyCloudChanges([{ collection: 'words', id: word.id, data: { ...word, enDefinition: 'updated on another device' }, revision: 1 }], 1)
  const result = await patchWord(word.id, { status: 'paused' })
  expect(result.enDefinition).toBe('updated on another device')
  expect((await readCloudState()).queue[0].data).toMatchObject({ status: 'paused', enDefinition: 'updated on another device' })
})

it('rejects a stale editor save atomically and retains the latest content', async () => {
  await selectDatabaseAccount(accountA)
  await writeBatch({ words: [word] })
  setDatabaseTrackingEnabled(true)
  await applyCloudChanges([{ collection: 'words', id: word.id, data: { ...word, enDefinition: 'remote update' }, revision: 1 }], 1)
  await expect(writeBatch({ words: [{ ...word, zhGloss: '本机编辑' }], expectedWords: [word] })).rejects.toThrow('已在其他')
  expect((await (await getDatabase()).get('words', word.id))?.enDefinition).toBe('remote update')
  expect((await readCloudState()).queue).toHaveLength(0)
})

it('keeps the current bundled seed body when restoring an unedited personal seed override', async () => {
  await selectDatabaseAccount(accountA)
  await writeBatch({ words: [{ ...word, source: 'seed', contentEdited: false, enDefinition: 'corrected in the current seed revision' }] })
  await applyCloudChanges([{ collection: 'words', id: word.id, data: { ...word, source: 'seed', contentEdited: false, enDefinition: 'old bundled definition', status: 'paused', knownAt: word.createdAt }, revision: 1 }], 1)
  const restored = await (await getDatabase()).get('words', word.id)
  expect(restored).toMatchObject({ enDefinition: 'corrected in the current seed revision', status: 'paused', knownAt: word.createdAt })
})
