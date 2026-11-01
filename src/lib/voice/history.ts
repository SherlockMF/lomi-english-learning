import { getDatabase } from '../db'
import type { VoiceFeedback } from './feedback'
import type { VoiceTurn } from './transcript'
import { notifyVoiceHistory, queueVoiceHistory, VOICE_CLEAR_KEY } from './historyCloudStorage'

export interface SavedVoiceTurn extends VoiceTurn {
  audio?: Blob
  audioPath?: string
  duration?: number
  status?: 'sending' | 'sent' | 'failed'
}
export interface VoiceHistoryMetadata {
  mode: 'realtime' | 'messages'
  scenario: string
  description: string
  difficulty: string
}
export interface VoiceHistoryRecord extends VoiceHistoryMetadata {
  id: string
  createdAt: string
  updatedAt: string
  elapsedSeconds: number
  turns: SavedVoiceTurn[]
  feedback: VoiceFeedback | null
  corrections: Record<string, VoiceFeedback['corrections']>
}
export type VoiceHistorySummary = Omit<VoiceHistoryRecord, 'turns' | 'feedback' | 'corrections'> & { turnCount: number }
type HistoryUpdate = Partial<Pick<VoiceHistoryRecord, 'turns' | 'elapsedSeconds' | 'feedback'>>

export function createVoiceHistoryWriter(metadata: VoiceHistoryMetadata) {
  // Capture the database now: late audio/feedback must never follow an account switch.
  const database = getDatabase()
  void database.catch(() => undefined)
  const now = new Date().toISOString()
  let record: VoiceHistoryRecord = { ...metadata, id: crypto.randomUUID(), createdAt: now, updatedAt: now, elapsedSeconds: 0, turns: [], feedback: null, corrections: {} }
  let pending: Promise<void> = Promise.resolve()
  function persist() {
    if (!record.turns.some(turn => turn.text.trim() || turn.audio)) return Promise.resolve()
    const snapshot = record
    const write = pending.then(async () => {
      const db = await database
      const tx = db.transaction(['voiceHistory', 'cloudMeta'], 'readwrite')
      const previous = await tx.objectStore('voiceHistory').get(snapshot.id)
      if (previous && 'deleted' in previous) {
        await tx.done
        throw new Error('这次练习已被删除。')
      }
      await tx.objectStore('voiceHistory').put(snapshot)
      await queueVoiceHistory(tx, snapshot.id)
      await tx.done
      notifyVoiceHistory()
    })
    pending = write.catch(() => undefined)
    return write
  }
  return {
    id: record.id,
    update(patch: HistoryUpdate) {
      record = { ...record, ...patch, updatedAt: new Date().toISOString() }
      return persist()
    },
    corrections(turnId: string, corrections: VoiceFeedback['corrections']) {
      record = { ...record, corrections: { ...record.corrections, [turnId]: corrections }, updatedAt: new Date().toISOString() }
      return persist()
    },
  }
}

export async function listVoiceHistory(): Promise<VoiceHistorySummary[]> {
  const db = await getDatabase()
  const summaries: VoiceHistorySummary[] = []
  let cursor = await db.transaction('voiceHistory').store.index('by-created-at').openCursor(null, 'prev')
  while (cursor) {
    if (!('deleted' in cursor.value)) {
      const { turns, feedback: _feedback, corrections: _corrections, ...metadata } = cursor.value
      summaries.push({ ...metadata, turnCount: turns.length })
    }
    // oxlint-disable-next-line no-await-in-loop -- An IndexedDB cursor must advance sequentially.
    cursor = await cursor.continue()
  }
  return summaries
}
export async function readVoiceHistory(id: string) {
  const record = await (await getDatabase()).get('voiceHistory', id)
  return record && !('deleted' in record) ? record : undefined
}
export async function deleteVoiceHistory(id: string) {
  // Keep only the random id to prevent another tab's pending write from restoring deleted content.
  const tx = (await getDatabase()).transaction(['voiceHistory', 'cloudMeta'], 'readwrite')
  await tx.objectStore('voiceHistory').put({ id, deleted: true })
  await queueVoiceHistory(tx, id)
  await tx.done
  notifyVoiceHistory()
}
export async function clearVoiceHistory() {
  const tx = (await getDatabase()).transaction(['voiceHistory', 'cloudMeta'], 'readwrite')
  await tx.objectStore('cloudMeta').put({ key: VOICE_CLEAR_KEY, value: crypto.randomUUID() })
  let cursor = await tx.objectStore('voiceHistory').openCursor()
  while (cursor) {
    // oxlint-disable-next-line no-await-in-loop -- Replace each record before advancing the same cursor.
    await cursor.update({ id: cursor.value.id, deleted: true })
    await queueVoiceHistory(tx, cursor.value.id)
    // oxlint-disable-next-line no-await-in-loop -- An IndexedDB cursor must advance sequentially.
    cursor = await cursor.continue()
  }
  await tx.done
  notifyVoiceHistory()
}
