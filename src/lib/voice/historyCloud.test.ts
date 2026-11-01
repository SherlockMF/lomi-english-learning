import { afterEach, expect, it, vi } from 'vitest'
import { getDatabase, selectDatabaseAccount, closeDatabase } from '../db'
import { createVoiceHistoryWriter, deleteVoiceHistory, clearVoiceHistory, readVoiceHistory } from './history'
import { createVoiceHistorySync, type VoiceHistoryTransport, type VoiceCloudRow } from './historyCloud'
import { readVoiceSyncState } from './historyCloudStorage'

const account = '00000000-0000-0000-0000-000000000001'
const metadata = { mode: 'realtime' as const, scenario: 'daily', description: '', difficulty: 'basic' }
const turns = [{ id: 'turn', role: 'user' as const, text: 'Hello', final: true, interrupted: false }]
afterEach(async () => {
  await selectDatabaseAccount(account)
  const db = await getDatabase()
  await db.clear('voiceHistory'); await db.clear('cloudMeta')
  await selectDatabaseAccount(null); await closeDatabase()
})
function remote() {
  const rows = new Map<string, VoiceCloudRow>()
  let revision = 0
  const transport: VoiceHistoryTransport = {
    pull: vi.fn(async (after) => ({ changes: [...rows.values()].filter(row => row.revision > after), revision, more: false })),
    push: vi.fn(async (id, record) => {
      if (rows.get(id)?.deleted) return rows.get(id)!
      const row = { id, data: record, deleted: !record, revision: ++revision }
      rows.set(id, row); return row
    }),
    clear: vi.fn(async () => { for (const id of rows.keys()) rows.set(id, { id, data: null, deleted: true, revision: ++revision }) }),
    cleanup: vi.fn(async () => ({ remaining: false })),
  }
  const state = vi.fn()
  return { rows, transport, state, engine: createVoiceHistorySync({ transport, onState: state }) }
}
it('backfills old local history and restores cloud metadata on another empty cache', async () => {
  await selectDatabaseAccount(account)
  const writer = createVoiceHistoryWriter(metadata); await writer.update({ turns })
  const db = await getDatabase(); await db.clear('cloudMeta') // pre-sync local version
  const { engine, transport, rows } = remote()
  await engine.sync()
  expect(transport.push).toHaveBeenCalledTimes(1)
  expect(rows.get(writer.id)?.data?.turns[0].text).toBe('Hello')
  expect((await readVoiceSyncState(db)).pending).toHaveLength(0)
  await db.clear('voiceHistory'); await db.clear('cloudMeta')
  await engine.sync()
  expect((await readVoiceHistory(writer.id))?.turns[0].text).toBe('Hello')
  expect(transport.push).toHaveBeenCalledTimes(1)
})
it('retains the outbox on upload failure and retries without losing a concurrent local save', async () => {
  await selectDatabaseAccount(account)
  const writer = createVoiceHistoryWriter(metadata); await writer.update({ turns })
  const { engine, transport, rows } = remote()
  const original = transport.push
  transport.push = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockImplementationOnce(async (...args: Parameters<typeof original>) => {
    await writer.update({ turns: [...turns, { ...turns[0], id: 'second', text: 'Again' }] })
    return original(...args)
  }).mockImplementation(original)
  await engine.sync()
  expect((await readVoiceSyncState(await getDatabase())).pending).toHaveLength(1)
  await engine.sync()
  expect(rows.get(writer.id)?.data?.turns).toHaveLength(2)
  expect((await readVoiceSyncState(await getDatabase())).pending).toHaveLength(0)
})
it('propagates tombstones and never uploads stale local history after a cloud deletion', async () => {
  await selectDatabaseAccount(account)
  const writer = createVoiceHistoryWriter(metadata); await writer.update({ turns })
  const { engine, transport } = remote()
  await engine.sync()
  await writer.update({ elapsedSeconds: 15 })
  await transport.push(writer.id, null, 0)
  const calls = vi.mocked(transport.push).mock.calls.length
  await engine.sync()
  expect(await readVoiceHistory(writer.id)).toBeUndefined()
  expect(vi.mocked(transport.push).mock.calls).toHaveLength(calls)
  await expect(writer.update({ turns })).rejects.toThrow('已被删除')
})
it('queues offline clear before new uploads and clears remote records missing from this device', async () => {
  await selectDatabaseAccount(account)
  const old = createVoiceHistoryWriter(metadata); await old.update({ turns })
  const { engine, rows, transport } = remote(); await engine.sync()
  await (await getDatabase()).clear('voiceHistory')
  await clearVoiceHistory()
  const fresh = createVoiceHistoryWriter(metadata); await fresh.update({ turns })
  await engine.sync()
  expect(transport.clear).toHaveBeenCalledTimes(1)
  expect(rows.get(old.id)?.deleted).toBe(true)
  expect(rows.get(fresh.id)?.deleted).toBe(false)
  await deleteVoiceHistory(fresh.id); await engine.sync()
  expect(rows.get(fresh.id)?.deleted).toBe(true)
})
it('stops after an account switch and does not apply a delayed response', async () => {
  await selectDatabaseAccount(account)
  const { engine, transport } = remote()
  transport.pull = vi.fn(async () => { await selectDatabaseAccount(null); return { changes: [], revision: 99, more: false } })
  await engine.sync()
  expect(transport.push).not.toHaveBeenCalled()
  expect(transport.cleanup).not.toHaveBeenCalled()
})
