import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'
import { loadSeedPackFromDisk } from './lib/loadSeedPack.mjs'

/** Upload only the fixed-id seed; browser-created dictionary ids belong to each user. */
export async function uploadSharedWords(client, words) {
  const ids = new Set()
  for (const word of words) {
    if (!word || typeof word.id !== 'string' || !word.id.trim() || word.id.length > 500 || ids.has(word.id)) {
      throw new Error('Invalid or duplicate shared word id')
    }
    ids.add(word.id)
  }
  for (let offset = 0; offset < words.length; offset += 200) {
    const rows = words.slice(offset, offset + 200).map((word) => ({ id: word.id, data: word }))
    // Preserve batch order and stop immediately after the first failed upload.
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('words').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error('Shared word upload failed')
  }
  return words.length
}

export async function seedCloudWords({ url, secret, words, fetcher = globalThis.fetch }) {
  const endpoint = new URL('/rest/v1/words?on_conflict=id', url)
  // New sb_secret_ keys belong only in apikey; they are not Bearer JWTs.
  const client = { from: () => ({ upsert: async (rows) => {
    const response = await fetcher(endpoint, { method: 'POST', redirect: 'error',
      headers: { apikey: secret, 'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows) })
    return { error: !response.ok }
  } }) }
  return uploadSharedWords(client, words)
}

export function seedNeonWords({ query, words, insertOnly = false }) {
  const client = { from: () => ({ upsert: async rows => {
    await query(`insert into public.words(id, data)
      select id, data from jsonb_to_recordset($1::jsonb) as word(id text, data jsonb)
      on conflict (id) ${insertOnly ? 'do nothing' : 'do update set data = excluded.data'}`, [JSON.stringify(rows)])
    return { error: false }
  } }) }
  return uploadSharedWords(client, words)
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const seed = await loadSeedPackFromDisk(root)
  const insertOnly = process.argv.includes('--expansion-v6')
  const words = insertOnly ? seed.words.filter(word => word.id.startsWith('v6-')) : seed.words
  if (insertOnly && !words.length) throw new Error('Missing V6 expansion words')
  if (process.argv.includes('--dry-run')) {
    if (new Set(words.map((word) => word.id)).size !== words.length) throw new Error('Duplicate shared word ids')
    console.log(`Shared words: ${words.length}`)
    return
  }
  const neonUrl = process.env.NEON_DATABASE_URL
  if (neonUrl) {
    const connection = new URL(neonUrl)
    if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('Invalid Neon database URL')
    connection.searchParams.set('sslmode', 'verify-full')
    const count = await seedNeonWords({ query: neon(connection.href).query, words, insertOnly })
    console.log(`Shared words: ${count}`)
    return
  }
  if (insertOnly) throw new Error('The V6 production import requires Neon')
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) throw new Error('Missing Supabase administrator environment configuration')
  const count = await seedCloudWords({ url, secret, words })
  console.log(`Shared words: ${count}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Provider diagnostics can contain request details; never echo credentials or bodies.
    console.error('Shared word import failed. Check configuration and service availability.')
    process.exitCode = 1
  })
}
