/* oxlint-disable no-await-in-loop -- Pull cursors and CAS acknowledgements depend on the previous operation. */
import { getDatabase, getDatabaseAccount } from '../db'
import { createCloudBroadcast } from '../cloud/broadcast'
import type { VoiceHistoryRecord } from './history'
import { acknowledgeVoiceClear, applyVoiceCloudRow, backfillVoiceHistory, readVoiceSyncState, VOICE_HISTORY_APPLIED, VOICE_HISTORY_CHANGED } from './historyCloudStorage'

export interface VoiceCloudRow { id: string; data: VoiceHistoryRecord | null; revision: number; deleted: boolean }
export interface VoiceHistoryTransport {
  pull(after: number, signal?: AbortSignal): Promise<{ changes: VoiceCloudRow[]; revision: number; more: boolean }>
  push(id: string, record: VoiceHistoryRecord | null, revision: number, signal?: AbortSignal): Promise<VoiceCloudRow>
  clear(requestId: string, signal?: AbortSignal): Promise<void>
  cleanup(signal?: AbortSignal): Promise<{ remaining: boolean }>
}
export interface VoiceCloudState { phase: 'syncing' | 'synced' | 'waiting' | 'error'; message: string }
const changed = () => window.dispatchEvent(new Event(VOICE_HISTORY_APPLIED))

export function createVoiceHistorySync({ transport, onState }: { transport: VoiceHistoryTransport; onState: (state: VoiceCloudState) => void }) {
  const account = getDatabaseAccount()
  const database = getDatabase()
  const controller = new AbortController()
  let stopped = false, running: Promise<void> | undefined
  let interval: ReturnType<typeof setInterval> | undefined, debounce: ReturnType<typeof setTimeout> | undefined
  let broadcast: ReturnType<typeof createCloudBroadcast> | undefined
  const active = () => !stopped && !!account && getDatabaseAccount() === account
  const status = (phase: VoiceCloudState['phase'], message: string) => { if (active()) onState({ phase, message }) }
  async function run() {
    if (!active()) return
    if (!navigator.onLine) { status('waiting', '语音历史待联网同步，本机记录已保留。'); return }
    status('syncing', '正在同步语音历史与录音…')
    try {
      const db = await database
      if (!active()) return
      await backfillVoiceHistory(db)
      for (let round = 0; round < 100 && active(); round++) {
        let state = await readVoiceSyncState(db)
        if (state.clear) {
          await transport.clear(String(state.clear), controller.signal)
          if (!active()) return
          await acknowledgeVoiceClear(db, state.clear)
        }
        const pulled = await transport.pull(state.revision, controller.signal)
        if (!active()) return
        if (!Number.isSafeInteger(pulled.revision) || pulled.revision < state.revision || !Array.isArray(pulled.changes)) throw new Error('Invalid voice revision')
        for (const row of pulled.changes) {
          if (!active()) return
          if (!Number.isSafeInteger(row.revision) || row.revision <= state.revision || row.revision > pulled.revision) throw new Error('Invalid voice revision')
          await applyVoiceCloudRow(db, row)
        }
        await db.put('cloudMeta', { key: 'voice:cursor', value: pulled.revision })
        if (pulled.changes.length) { changed(); broadcast?.notify() }
        if (pulled.more) continue
        state = await readVoiceSyncState(db)
        if (state.clear) continue
        const entry = state.pending[0]
        if (!entry) {
          const cleanup = await transport.cleanup(controller.signal)
          status(cleanup.remaining ? 'waiting' : 'synced', cleanup.remaining ? '文字已同步，已删除录音正在清理，将自动重试。' : '语音历史与录音已同步')
          return
        }
        if (!entry.record) throw new Error('Missing voice outbox record')
        try {
          const result = await transport.push(entry.id, 'deleted' in entry.record ? null : entry.record, entry.revision, controller.signal)
          if (!active()) return
          await applyVoiceCloudRow(db, result, entry.nonce)
          changed(); broadcast?.notify()
        } catch (error) {
          if ((error as { code?: string }).code === '40001') continue
          throw error
        }
      }
      status('waiting', '语音历史正在分批同步，剩余记录将自动继续。')
    } catch {
      status('error', '语音历史同步未完成，本机记录已保留；请重试同步，完成前不要清除站点数据。')
    }
  }
  function sync() {
    if (running) return running
    running = (async () => {
      if (navigator.locks && account) await navigator.locks.request(`lomi-voice:${account}`, { signal: controller.signal }, run)
      else await run()
    })().catch(() => status('error', '语音历史同步未完成，请重试。')).finally(() => { running = undefined })
    return running
  }
  const schedule = () => { clearTimeout(debounce); debounce = setTimeout(() => void sync(), 2000) }
  const localChanged = () => { broadcast?.notify(); schedule() }
  return { sync,
    start() { if (account) broadcast = createCloudBroadcast(`voice:${account}`, () => { if (active()) { changed(); schedule() } }); window.addEventListener(VOICE_HISTORY_CHANGED, localChanged); window.addEventListener('online', schedule); interval = setInterval(() => void sync(), 30_000); void sync() },
    stop() { stopped = true; controller.abort(); broadcast?.close(); clearInterval(interval); clearTimeout(debounce); window.removeEventListener(VOICE_HISTORY_CHANGED, localChanged); window.removeEventListener('online', schedule) },
  }
}
