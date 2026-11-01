/* oxlint-disable no-await-in-loop -- Delete one bounded page before listing again or acknowledging the tombstone. */
// Storage objects must be physically removed with Storage API, never SQL DELETE.
export async function cleanupVoiceHistory({ userId, supabase, secret, call }) {
  if (!/^[a-f0-9-]{36}$/i.test(userId)) throw new Error('Invalid cleanup owner')
  const headers = { apikey: secret, 'Content-Type': 'application/json' }
  const query = new URL('/rest/v1/voice_history', supabase)
  query.search = new URLSearchParams({ user_id: `eq.${userId}`, deleted: 'eq.true', cleanup_pending: 'eq.true', select: 'id', limit: '20' }).toString()
  const selected = await call(query, { headers })
  if (!selected.ok) throw new Error('Voice cleanup unavailable')
  const records = await selected.json()
  if (!Array.isArray(records)) throw new Error('Invalid cleanup records')
  let cleaned = 0
  for (const record of records) {
    if (!/^[a-f0-9-]{36}$/i.test(record.id)) throw new Error('Invalid cleanup record')
    const prefix = `${userId}/${record.id}`
    let complete = false
    for (let batch = 0; batch < 10; batch++) {
      const listed = await call(new URL('/storage/v1/object/list/voice-history', supabase), { method: 'POST', headers, body: JSON.stringify({ prefix, limit: 100, offset: 0 }) })
      if (!listed.ok) throw new Error('Audio listing failed')
      const files = await listed.json()
      if (!Array.isArray(files) || files.some(file => !/^[a-f0-9]{64}\.wav$/.test(file.name))) throw new Error('Invalid audio paths')
      if (!files.length) { complete = true; break }
      const removed = await call(new URL('/storage/v1/object/voice-history', supabase), { method: 'DELETE', headers, body: JSON.stringify({ prefixes: files.map(file => `${prefix}/${file.name}`) }) })
      if (!removed.ok) throw new Error('Audio removal failed')
    }
    if (!complete) return { cleaned, remaining: true }
    const acknowledge = new URL('/rest/v1/voice_history', supabase)
    acknowledge.search = new URLSearchParams({ user_id: `eq.${userId}`, id: `eq.${record.id}`, deleted: 'eq.true' }).toString()
    const updated = await call(acknowledge, { method: 'PATCH', headers, body: JSON.stringify({ cleanup_pending: false }) })
    if (!updated.ok) throw new Error('Cleanup acknowledgement failed')
    cleaned++
  }
  return { cleaned, remaining: records.length === 20 }
}
