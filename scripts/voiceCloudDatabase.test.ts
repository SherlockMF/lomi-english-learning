import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

let db: PGlite
const a = '00000000-0000-0000-0000-000000000001'
const b = '00000000-0000-0000-0000-000000000002'
const id = '10000000-0000-0000-0000-000000000001'
const data = { id, mode: 'messages', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', scenario: 'daily', description: '', difficulty: 'basic', elapsedSeconds: 5, turns: [], corrections: {}, feedback: null }
async function as(user: string, role = 'authenticated') {
  await db.exec(`reset role; set role ${role}`)
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
}
async function rpc(name: string, args: unknown[] = []) {
  return (await db.query<{ result: any }>(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)).rows[0].result
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    insert into auth.users values ('${a}'),('${b}');
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,service_role;
    grant select,insert,update,delete on storage.objects to authenticated,service_role;`)
  await db.exec(await readFile('supabase/migrations/202610230001_cloud.sql', 'utf8'))
  await db.exec(await readFile('supabase/migrations/202611020001_voice_history.sql', 'utf8'))
  await db.exec(`insert into app_memberships(user_id) values ('${a}'),('${b}')`)
}, 30_000)
afterAll(async () => { await db?.close() })

it('keeps voice metadata and private audio isolated and rejects stale writes and resurrection', async () => {
  await as(a)
  await rpc('voice_history_prepare', [id])
  const row = await rpc('voice_history_apply', [id, 0, JSON.stringify(data)])
  expect(row.revision).toBe(1)
  await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['voice-history', `${a}/${id}/${'a'.repeat(64)}.wav`])
  await expect(rpc('voice_history_apply', [id, 0, JSON.stringify(data)])).rejects.toMatchObject({ code: '40001' })
  await as(b)
  expect((await rpc('voice_history_pull', [0])).changes).toEqual([])
  expect((await db.query('select * from storage.objects')).rows).toEqual([])
  await expect(db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['voice-history', `${a}/${id}/${'b'.repeat(64)}.wav`])).rejects.toMatchObject({ code: '42501' })
  await as(a)
  const removed = await rpc('voice_history_apply', [id, 0, null])
  expect(removed.deleted).toBe(true)
  expect(removed.data).toBeNull()
  expect((await rpc('voice_history_apply', [id, 1, JSON.stringify(data)])).deleted).toBe(true)
  expect((await db.query('select * from storage.objects')).rows).toEqual([])
  await expect(db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['voice-history', `${a}/${id}/${'c'.repeat(64)}.wav`])).rejects.toMatchObject({ code: '42501' })
  expect((await rpc('voice_history_pull', [1])).changes[0].deleted).toBe(true)
})

it('paginates without skipping records or replaying the cursor boundary', async () => {
  await as(a)
  for (let i = 2; i <= 102; i++) {
    const nextId = `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`
    await rpc('voice_history_apply', [nextId, 0, JSON.stringify({ ...data, id: nextId })])
  }
  const first = await rpc('voice_history_pull', [0])
  expect(first.changes).toHaveLength(100)
  expect(first.more).toBe(true)
  const second = await rpc('voice_history_pull', [first.revision])
  expect(second.changes).toHaveLength(2)
  expect(second.more).toBe(false)
  expect(new Set([...first.changes, ...second.changes].map(row => row.id)).size).toBe(102)
})

it('clears drafts and committed histories, validates payloads, and denies inactive or anonymous users', async () => {
  await as(b)
  await rpc('voice_history_prepare', [id])
  await expect(rpc('voice_history_apply', [id, 0, JSON.stringify({ ...data, turns: 'wrong' })])).rejects.toMatchObject({ code: '22023' })
  const clearId = '20000000-0000-0000-0000-000000000001'
  await rpc('voice_history_clear', [clearId])
  expect((await rpc('voice_history_prepare', [id])).deleted).toBe(true)
  const freshId = '10000000-0000-0000-0000-000000000002'
  await rpc('voice_history_apply', [freshId, 0, JSON.stringify({ ...data, id: freshId })])
  await rpc('voice_history_clear', [clearId])
  expect((await rpc('voice_history_prepare', [freshId])).deleted).toBe(false)
  await as(b, 'service_role')
  await db.query('update app_memberships set active=false where user_id=$1', [b])
  await as(b)
  await expect(rpc('voice_history_pull', [0])).rejects.toMatchObject({ code: '42501' })
  await expect(rpc('voice_history_prepare', [id])).rejects.toMatchObject({ code: '42501' })
  await as('', 'anon')
  await expect(rpc('voice_history_pull', [0])).rejects.toMatchObject({ code: '42501' })
})
