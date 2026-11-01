/* oxlint-disable no-await-in-loop -- IndexedDB transactions and per-record versions must advance in order. */
import type { IDBPDatabase, IDBPTransaction } from 'idb'
import type { RecallEnglishDatabase } from '../db'
import type { VoiceCloudRow } from './historyCloud'

export const VOICE_HISTORY_CHANGED = 'lomi-voice-history-changed'
export const VOICE_HISTORY_APPLIED = 'lomi-voice-history-applied'
export const VOICE_CLEAR_KEY = 'voice:clear'
const pendingKey = (id: string) => `voice:pending:${id}`
const versionKey = (id: string) => `voice:version:${id}`
type VoiceTransaction = IDBPTransaction<RecallEnglishDatabase, ['voiceHistory', 'cloudMeta'], 'readwrite'>
export async function queueVoiceHistory(tx: VoiceTransaction, id: string) {
  await tx.objectStore('cloudMeta').put({ key: pendingKey(id), value: crypto.randomUUID() })
}
export function notifyVoiceHistory() { window.dispatchEvent(new Event(VOICE_HISTORY_CHANGED)) }

export async function backfillVoiceHistory(db: IDBPDatabase<RecallEnglishDatabase>) {
  const tx = db.transaction(['voiceHistory', 'cloudMeta'], 'readwrite')
  const records = await tx.objectStore('voiceHistory').getAllKeys()
  for (const id of records) {
    if (!(await tx.objectStore('cloudMeta').get(versionKey(id))) && !(await tx.objectStore('cloudMeta').get(pendingKey(id)))) await queueVoiceHistory(tx, id)
  }
  await tx.done
}
export async function readVoiceSyncState(db: IDBPDatabase<RecallEnglishDatabase>) {
  const tx = db.transaction(['voiceHistory', 'cloudMeta'])
  const meta = await tx.objectStore('cloudMeta').getAll()
  const versions = new Map(meta.filter(row => row.key.startsWith('voice:version:')).map(row => [row.key.slice(14), Number(row.value)]))
  const pending = await Promise.all(meta.filter(row => row.key.startsWith('voice:pending:')).map(async row => {
    const id = row.key.slice(14)
    return { id, nonce: String(row.value), revision: versions.get(id) ?? 0, record: await tx.objectStore('voiceHistory').get(id) }
  }))
  await tx.done
  return { pending, revision: Number(meta.find(row => row.key === 'voice:cursor')?.value ?? 0), clear: meta.find(row => row.key === VOICE_CLEAR_KEY)?.value }
}
export async function applyVoiceCloudRow(db: IDBPDatabase<RecallEnglishDatabase>, row: VoiceCloudRow, nonce?: string) {
  const tx = db.transaction(['voiceHistory', 'cloudMeta'], 'readwrite')
  const meta = tx.objectStore('cloudMeta'), store = tx.objectStore('voiceHistory')
  const pending = await meta.get(pendingKey(row.id))
  const previous = await store.get(row.id)
  // A tombstone always wins, including against a late acknowledgement or offline save.
  if (row.deleted) {
    await store.put({ id: row.id, deleted: true })
    await meta.delete(pendingKey(row.id))
  } else if (row.data && (!pending || pending.value === nonce)) {
    const localTurns = previous && !('deleted' in previous) ? previous.turns : []
    await store.put({ ...row.data, turns: row.data.turns.map(turn => {
      const local = localTurns.find(value => value.id === turn.id)
      return local?.audio ? { ...turn, audio: local.audio } : turn
    }) })
    await meta.delete(pendingKey(row.id))
  }
  await meta.put({ key: versionKey(row.id), value: row.revision })
  await tx.done
}
export async function acknowledgeVoiceClear(db: IDBPDatabase<RecallEnglishDatabase>, nonce: unknown) {
  const tx = db.transaction('cloudMeta', 'readwrite')
  if ((await tx.store.get(VOICE_CLEAR_KEY))?.value === nonce) await tx.store.delete(VOICE_CLEAR_KEY)
  await tx.done
}
