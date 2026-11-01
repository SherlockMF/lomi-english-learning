/* oxlint-disable no-await-in-loop -- Bound audio memory/network usage and check account ownership between uploads. */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDatabaseAccount } from '../db'
import { getCloudClient } from '../cloud/client'
import { apiFetch } from '../apiFetch'
import type { VoiceHistoryRecord } from './history'
import type { VoiceCloudRow, VoiceHistoryTransport } from './historyCloud'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown) => typeof value === 'string'
const correction = (row: unknown) => object(row) && string(row.original) && string(row.improved) && string(row.explanationZh)
const validAudioPath = (path: string, account: string, id?: string) => new RegExp(`^${account}/${id ?? '[a-f0-9-]{36}'}/[a-f0-9]{64}\\.wav$`).test(path)
function validateRow(value: unknown, account: string): VoiceCloudRow {
  if (!object(value) || !uuid.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.deleted !== 'boolean') throw new Error('Invalid voice history')
  if (value.deleted || value.data === null) return { id: value.id, revision: value.revision, deleted: value.deleted, data: null }
  const data = value.data
  if (!object(data) || data.id !== value.id || !['messages', 'realtime'].includes(data.mode)
    || !string(data.createdAt) || !Number.isFinite(Date.parse(data.createdAt)) || !string(data.updatedAt) || !Number.isFinite(Date.parse(data.updatedAt))
    || !string(data.description) || !string(data.scenario) || !string(data.difficulty) || !Number.isFinite(data.elapsedSeconds) || data.elapsedSeconds < 0
    || !Array.isArray(data.turns) || data.turns.length > 2000 || !object(data.corrections)
    || Object.values(data.corrections).some(rows => !Array.isArray(rows) || !rows.every(correction))
    || (data.feedback !== null && (!object(data.feedback) || !string(data.feedback.summaryZh) || !Array.isArray(data.feedback.corrections) || !data.feedback.corrections.every(correction)
      || !Array.isArray(data.feedback.expressions) || !data.feedback.expressions.every((row: unknown) => object(row) && string(row.en) && string(row.zh))))
    || data.turns.some((turn: unknown) => !object(turn) || !string(turn.id) || !string(turn.text) || !['user', 'assistant'].includes(turn.role)
      || typeof turn.final !== 'boolean' || typeof turn.interrupted !== 'boolean' || 'audio' in turn
      || (turn.audioPath !== undefined && (!string(turn.audioPath) || !validAudioPath(turn.audioPath, account, value.id)))
      || (turn.duration !== undefined && (!Number.isFinite(turn.duration) || turn.duration < 0)))) throw new Error('Invalid voice history content')
  return value as unknown as VoiceCloudRow
}

export function createVoiceHistoryTransport(client: SupabaseClient, account: string): VoiceHistoryTransport {
  const check = (signal?: AbortSignal) => { if (!uuid.test(account) || getDatabaseAccount() !== account || signal?.aborted) throw new Error('Voice account changed') }
  async function rpc(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    check(signal)
    const result = await client.rpc(name, args).abortSignal(signal ?? new AbortController().signal)
    check(signal)
    if (result.error) throw result.error
    return result.data
  }
  return {
    async pull(after, signal) {
      const result = await rpc('voice_history_pull', { p_after_revision: after }, signal)
      if (!object(result) || !Array.isArray(result.changes) || result.changes.length > 100 || typeof result.more !== 'boolean') throw new Error('Invalid voice page')
      return { revision: result.revision, more: result.more, changes: result.changes.map(row => validateRow(row, account)) }
    },
    async push(id, record, revision, signal) {
      check(signal)
      if (!uuid.test(id)) throw new Error('Invalid history id')
      let data: VoiceHistoryRecord | null = null
      if (record) {
        const prepared = validateRow(await rpc('voice_history_prepare', { p_id: id }, signal), account)
        if (prepared.deleted) return prepared
        const turns = []
        for (const { audio, ...turn } of record.turns) {
          check(signal)
          if (audio) {
            if (audio.size > 50 * 1024 * 1024) throw new Error('Audio exceeds storage limit')
            const bytes = await audio.arrayBuffer()
            const digest = await crypto.subtle.digest('SHA-256', bytes)
            const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
            turn.audioPath = `${account}/${id}/${hash}.wav`
            check(signal)
            if (!prepared.data?.turns.some(saved => saved.audioPath === turn.audioPath)) {
              const uploaded = await client.storage.from('voice-history').upload(turn.audioPath, bytes, { contentType: 'audio/wav', cacheControl: '0', upsert: false })
              check(signal)
              if (uploaded.error && String((uploaded.error as { statusCode?: string }).statusCode) !== '409') throw uploaded.error
            }
          }
          turns.push(turn)
        }
        data = { ...record, turns }
        validateRow({ id, revision, deleted: false, data }, account)
      }
      return validateRow(await rpc('voice_history_apply', { p_id: id, p_expected_revision: revision, p_data: data }, signal), account)
    },
    async clear(requestId, signal) { await rpc('voice_history_clear', { p_request_id: requestId }, signal) },
    async cleanup(signal) {
      check(signal)
      const result = await apiFetch('/api/voice-history/cleanup', { method: 'POST', signal })
      check(signal)
      if (!result.ok) throw new Error('Voice audio cleanup failed')
      const data = await result.json()
      if (typeof data.remaining !== 'boolean') throw new Error('Invalid cleanup response')
      return data
    },
  }
}

export async function downloadVoiceHistoryAudio(path: string, account: string, signal: AbortSignal) {
  if (!uuid.test(account) || getDatabaseAccount() !== account || !validAudioPath(path, account)) throw new Error('Invalid audio owner')
  const result = await getCloudClient().storage.from('voice-history').download(path, {}, { signal, cache: 'no-store' })
  if (result.error || getDatabaseAccount() !== account || signal.aborted) throw new Error('Audio download failed')
  return result.data
}
