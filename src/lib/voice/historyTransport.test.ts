import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { selectDatabaseAccount, closeDatabase } from '../db'
import { createVoiceHistoryTransport } from './historyTransport'
import type { VoiceHistoryRecord } from './history'

const account = '00000000-0000-0000-0000-000000000001'
const record: VoiceHistoryRecord = { id: '10000000-0000-0000-0000-000000000001', mode: 'messages', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', scenario: 'daily', description: '', difficulty: 'basic', elapsedSeconds: 5, turns: [{ id: 'turn', role: 'user', text: 'Hello', final: true, interrupted: false, audio: new NodeBlob(['audio'], { type: 'audio/wav' }) as Blob }], corrections: {}, feedback: null }
afterEach(async () => { vi.unstubAllGlobals(); await selectDatabaseAccount(null); await closeDatabase() })
it('uploads immutable audio once, excludes Blobs from JSON and accepts duplicate retry objects', async () => {
  vi.stubGlobal('crypto', webcrypto)
  await selectDatabaseAccount(account)
  const upload = vi.fn(async () => ({ error: { statusCode: '409', message: 'already exists' } }))
  const calls: any[] = []
  const client = { storage: { from: () => ({ upload }) }, rpc: (name: string, args: any) => {
    calls.push({ name, args })
    return { abortSignal: async () => ({ data: { id: record.id, deleted: false, revision: name === 'voice_history_prepare' ? 0 : 1, data: name === 'voice_history_prepare' ? null : args.p_data }, error: null }) }
  } }
  const transport = createVoiceHistoryTransport(client as any, account)
  const result = await transport.push(record.id, record, 0)
  expect(upload).toHaveBeenCalledTimes(1)
  expect(result.data?.turns[0].audioPath).toMatch(new RegExp(`^${account}/${record.id}/[a-f0-9]{64}\\.wav$`))
  expect(result.data?.turns[0]).not.toHaveProperty('audio')
  expect(calls[1].args.p_data.turns[0]).not.toHaveProperty('audio')
})
it('does not upload after deletion or report success when audio upload fails', async () => {
  vi.stubGlobal('crypto', webcrypto)
  await selectDatabaseAccount(account)
  const upload = vi.fn(async () => ({ error: { statusCode: '413' } }))
  let deleted = true
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: { id: record.id, data: null, revision: 1, deleted }, error: null }) }))
  const transport = createVoiceHistoryTransport({ storage: { from: () => ({ upload }) }, rpc } as any, account)
  expect((await transport.push(record.id, record, 0)).deleted).toBe(true)
  expect(upload).not.toHaveBeenCalled()
  deleted = false
  await expect(transport.push(record.id, record, 0)).rejects.toMatchObject({ statusCode: '413' })
  expect(rpc).toHaveBeenCalledTimes(2)
})
