import { afterEach, expect, it } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { clearDatabase, closeDatabase, selectDatabaseAccount } from '../db'
import { createVoiceHistoryWriter, listVoiceHistory, readVoiceHistory, deleteVoiceHistory, clearVoiceHistory } from './history'

afterEach(async () => {
  for (const account of [null, 'history-test-a', 'history-test-b']) {
    // oxlint-disable-next-line no-await-in-loop -- Only one account database can be selected at a time.
    await selectDatabaseAccount(account)
    // oxlint-disable-next-line no-await-in-loop -- Clear the selected account before switching.
    await clearDatabase()
  }
  await selectDatabaseAccount(null); await closeDatabase()
})

const metadata = { mode: 'messages' as const, scenario: 'daily', description: '点咖啡', difficulty: 'basic' }
const turn = { id: 'u1', role: 'user' as const, text: 'Coffee, please.', final: true, interrupted: false }

it('retains transcript, audio and feedback after closing and reopening the database', async () => {
  const writer = createVoiceHistoryWriter(metadata)
  // fake-indexeddb uses Node structuredClone; jsdom Blob is not cloneable there.
  await writer.update({ turns: [{ ...turn, audio: new NodeBlob(['audio'], { type: 'audio/wav' }) as Blob, duration: 2 }], elapsedSeconds: 12 })
  await writer.update({ feedback: { summaryZh: '练习完成', corrections: [], expressions: [] } })
  await writer.corrections('u1', [])
  await closeDatabase()
  const records = await listVoiceHistory()
  expect(records).toHaveLength(1)
  const saved = await readVoiceHistory(records[0].id)
  expect(saved?.turns[0].text).toBe(turn.text)
  expect(saved?.turns[0].audio?.size).toBe(5)
  expect(saved?.feedback?.summaryZh).toBe('练习完成')
  expect(saved?.corrections.u1).toEqual([])
  expect(saved?.elapsedSeconds).toBe(12)
})

it('keeps sessions separate, ignores empty sessions and deletes only requested history', async () => {
  await createVoiceHistoryWriter(metadata).update({ turns: [] })
  expect(await listVoiceHistory()).toHaveLength(0)
  const first = createVoiceHistoryWriter(metadata)
  await first.update({ turns: [turn] })
  const second = createVoiceHistoryWriter(metadata)
  await second.update({ turns: [{ ...turn, id: 'u2' }] })
  await deleteVoiceHistory(first.id)
  expect(await readVoiceHistory(first.id)).toBeUndefined()
  expect((await listVoiceHistory()).map(record => record.id)).toEqual([second.id])
  await clearVoiceHistory()
  expect(await listVoiceHistory()).toHaveLength(0)
})

it('does not resurrect deleted history when a late write arrives from another page', async () => {
  const writer = createVoiceHistoryWriter(metadata)
  await writer.update({ turns: [turn] })
  await deleteVoiceHistory(writer.id)
  await expect(writer.update({ feedback: { summaryZh: '迟到的反馈', corrections: [], expressions: [] } })).rejects.toThrow('删除')
  expect(await readVoiceHistory(writer.id)).toBeUndefined()
  expect(await listVoiceHistory()).toHaveLength(0)
  const next = createVoiceHistoryWriter(metadata)
  await next.update({ turns: [turn] })
  await clearVoiceHistory()
  await expect(next.update({ elapsedSeconds: 50 })).rejects.toThrow('删除')
  expect(await listVoiceHistory()).toHaveLength(0)
})

it('isolates account history and never saves a late result into another account', async () => {
  await selectDatabaseAccount('history-test-a')
  const writer = createVoiceHistoryWriter(metadata)
  await writer.update({ turns: [turn] })
  await selectDatabaseAccount('history-test-b')
  expect(await listVoiceHistory()).toHaveLength(0)
  await expect(writer.update({ elapsedSeconds: 20 })).rejects.toThrow()
  expect(await listVoiceHistory()).toHaveLength(0)
  await selectDatabaseAccount('history-test-a')
  expect(await listVoiceHistory()).toHaveLength(1)
})
