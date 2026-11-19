import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readNeonSchema } from './neonSchema.mjs'

const trial = '00000000-0000-0000-0000-000000000001'
const unverified = '00000000-0000-0000-0000-000000000002'
const disabled = '00000000-0000-0000-0000-000000000003'
const standard = '00000000-0000-0000-0000-000000000004'
const social = '00000000-0000-0000-0000-000000000005'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anonymous;
    create role authenticated;
    create schema auth;
    create function auth.user_id() returns text language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '') $$;
    grant usage on schema auth to authenticated;
    create schema neon_auth;
    create table neon_auth."user" (id uuid primary key, "emailVerified" boolean, banned boolean);
    create table neon_auth.account ("userId" uuid, "providerId" text, password text);
    insert into neon_auth."user" values ('${trial}',true,false), ('${unverified}',false,false),
      ('${disabled}',true,false), ('${standard}',false,false), ('${social}',true,false);
    insert into neon_auth.account values ('${trial}','credential','fixture'), ('${unverified}','credential','fixture'),
      ('${disabled}','credential','fixture'), ('${social}','google',null);
  `)
  await db.exec(await readNeonSchema())
  await db.exec(await readFile('scripts/neonRuntime.sql', 'utf8'))
  await db.query('insert into app_memberships(user_id,active) values ($1,false),($2,true)', [disabled, standard])
  await db.exec(await readFile('scripts/neonMembership.sql', 'utf8'))
  await db.query("update app_memberships set plan='standard', plan_started_at=now() where user_id=$1", [standard])
}, 30_000)

afterAll(async () => { await db?.close() })

async function membership(userId: string) {
  await db.exec('reset role; set role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId])
  return (await db.query<{ status: Record<string, unknown> }>('select public.lomi_membership() as status')).rows[0].status
}

async function reserve(userId: string, resource: string, requestId: string, units: number) {
  await db.exec('reset role; set role lomi_runtime;')
  return (await db.query<{ result: { allowed: boolean; metered: boolean } }>(
    'select public.lomi_reserve_allowance($1,$2,$3,$4) as result', [userId, resource, requestId, units])).rows[0].result
}

it('starts one trial for a verified password identity and preserves existing member states', async () => {
  expect(await membership(unverified)).toEqual({ active: false, needs_verification: true })
  expect(await membership(social)).toEqual({ active: false })
  expect(await membership(disabled)).toEqual({ active: false })
  const first = await membership(trial)
  expect(first).toMatchObject({ active: true, plan: 'trial', voice_ms: 600_000, credits: 1000 })
  expect(await membership(trial)).toEqual(first)
  expect(await membership(standard)).toMatchObject({ active: true, plan: 'standard', expires_at: null, voice_ms: 1_800_000, credits: 5000 })
  await expect(db.query('select * from public.lomi_allowance_events')).rejects.toMatchObject({ code: '42501' })
})

it('meters repeated requests once, settles credits, and keeps learning enabled after expiration', async () => {
  await membership(trial)
  const request = '00000000-0000-4000-8000-000000000010'
  const other = '00000000-0000-4000-8000-000000000011'
  expect(await reserve(trial, 'credits', request, 999)).toEqual({ allowed: true, metered: true })
  expect(await reserve(trial, 'credits', request, 999)).toEqual({ allowed: true, metered: true })
  expect(await reserve(trial, 'credits', other, 2)).toMatchObject({ allowed: false })
  await db.query('select public.lomi_settle_credits($1,$2,$3)', [trial, request, 3])
  expect(await membership(trial)).toMatchObject({ credits: 997 })
  expect(await reserve(trial, 'credits', other, 500)).toMatchObject({ allowed: true })
  await db.query('select public.lomi_settle_credits($1,$2,$3)', [trial, other, 0])
  expect(await reserve(trial, 'credits', other, 500)).toMatchObject({ allowed: false })
  expect(await membership(trial)).toMatchObject({ credits: 997 })
  expect(await reserve(trial, 'voice', '00000000-0000-4000-8000-000000000012', 60_000)).toMatchObject({ allowed: true })
  expect(await membership(trial)).toMatchObject({ voice_ms: 540_000 })
  expect(await reserve(trial, 'recording', request, 60 * 1024 * 1024)).toMatchObject({ allowed: true })
  expect(await reserve(trial, 'recording', request, 60 * 1024 * 1024)).toMatchObject({ allowed: true })
  expect(await reserve(trial, 'recording', other, 5 * 1024 * 1024)).toMatchObject({ allowed: false })
  await db.exec('reset role;')
  await db.query("update app_memberships set plan_started_at=now()-interval '15 days' where user_id=$1", [trial])
  expect(await reserve(trial, 'voice', other, 1000)).toMatchObject({ allowed: false })
  expect(await membership(trial)).toMatchObject({ active: true, plan: 'trial', voice_ms: 0, credits: 0 })
  await expect(db.query('select public.cloud_pull(0)')).resolves.toBeDefined()
})
