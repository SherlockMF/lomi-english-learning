import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readNeonSchema } from './neonSchema.mjs'

const alice = '00000000-0000-0000-0000-000000000001'
const bob = '00000000-0000-0000-0000-000000000002'
const inactive = '00000000-0000-0000-0000-000000000003'
const historyId = '10000000-0000-0000-0000-000000000001'
let db: PGlite

async function authenticate(userId: string) {
  await db.exec('reset role; set role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anonymous nologin;
    create role authenticated nologin;
    revoke usage on schema public from public;
    create schema auth;
    create function auth.user_id() returns text language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '') $$;
    grant usage on schema auth to authenticated;
    create schema neon_auth;
    create table neon_auth."user" (id uuid primary key);
    insert into neon_auth."user" values ('${alice}'), ('${bob}'), ('${inactive}');
  `)
  await db.exec(await readNeonSchema())
  await db.query('insert into app_memberships(user_id, active) values ($1, true), ($2, true), ($3, false)', [alice, bob, inactive])
}, 30_000)

afterAll(async () => { await db?.close() })

it('keeps cloud revisions and rows isolated by the authenticated Neon identity', async () => {
  await authenticate(alice)
  const changes = [{ collection: 'settings', id: 'primary', data: { id: 'primary' } }]
  await db.query('select cloud_apply(0, $1::jsonb)', [JSON.stringify(changes)])
  await expect(db.query('select cloud_apply(0, $1::jsonb)', [JSON.stringify(changes)])).rejects.toMatchObject({ code: '40001' })
  await authenticate(bob)
  expect((await db.query<{ data: { changes: unknown[] } }>('select cloud_pull(0) as data')).rows[0].data.changes).toEqual([])
  expect((await db.query('select user_id from app_memberships')).rows).toEqual([{ user_id: bob }])
  await authenticate(inactive)
  await expect(db.query('select cloud_pull(0)')).rejects.toMatchObject({ code: '42501' })
})

it('restricts voice audio paths to the member who owns a live history record', async () => {
  const path = `${alice}/${historyId}/${'a'.repeat(64)}.wav`
  await authenticate(alice)
  await db.query('select voice_history_prepare($1)', [historyId])
  const allowed = async () => (await db.query('select voice_audio_allowed($1, true) as allowed', [path])).rows
  expect(await allowed()).toEqual([{ allowed: true }])
  await authenticate(bob)
  expect(await allowed()).toEqual([{ allowed: false }])
  await authenticate(alice)
  await db.query('select voice_history_apply($1, 0, null)', [historyId])
  expect(await allowed()).toEqual([{ allowed: false }])
})

it('allows the database owner to reserve usage and denies public application roles', async () => {
  const reserve = () => db.query<{ data: { allowed: boolean } }>(
    "select reserve_usage($1, 'deepseek', gen_random_uuid()) as data", [alice])
  await authenticate(alice)
  await expect(reserve()).rejects.toMatchObject({ code: '42501' })
  await db.exec('reset role; set role anonymous;')
  await expect(db.query('select * from public.app_memberships')).rejects.toMatchObject({ code: '42501' })
  await db.exec('reset role;')
  expect((await reserve()).rows[0].data.allowed).toBe(true)
})

it('grants the Render runtime the history locks and cleanup it needs without allowing membership edits', async () => {
  await db.exec('reset role;')
  await db.exec(await readFile('scripts/neonRuntime.sql', 'utf8'))
  await db.query(`insert into public.voice_history (user_id, id, deleted, cleanup_pending) values ($1, $2, true, true)
    on conflict (user_id, id) do update set deleted = true, cleanup_pending = true`, [alice, historyId])
  await db.exec('set role lomi_runtime;')
  const locked = await db.query(`select h.id from public.voice_history h join public.app_memberships m using (user_id)
    where h.user_id = $1 and h.id = $2 for share of h, m`, [alice, historyId])
  expect(locked.rows).toEqual([{ id: historyId }])
  await expect(db.query('update app_memberships set active = false where user_id = $1', [alice])).rejects.toMatchObject({ code: '42501' })
  await expect(db.query('select * from cloud_revisions')).rejects.toMatchObject({ code: '42501' })
  await expect(db.query('update voice_history set cleanup_pending = false where user_id = $1 and id = $2', [alice, historyId])).resolves.toMatchObject({ affectedRows: 1 })
  await db.exec('reset role;')
})
