/* oxlint-disable no-await-in-loop -- Hold the history lock through uploads and remove bounded cleanup pages in order. */
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Pool } from '@neondatabase/serverless'
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const audioRoute = /^\/api\/voice-history\/([a-f0-9-]{36})\/audio\/([a-f0-9]{64})\.wav$/
const audioLimit = 50 * 1024 * 1024
const concurrentAudioUploads = 2
const bucket = 'voice-history'
const connectionKeys = ['VITE_NEON_AUTH_URL', 'VITE_NEON_DATA_URL', 'NEON_DATABASE_URL', 'AWS_ENDPOINT_URL_S3',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION']

function httpsUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid Neon service URL')
  return url
}

export function createNeonBackend({ env, call, database, objectStorage }) {
  if (connectionKeys.some(key => typeof env[key] !== 'string' || !env[key].trim())) throw new Error('Missing Neon production configuration')
  httpsUrl(env.VITE_NEON_AUTH_URL)
  const dataUrl = httpsUrl(env.VITE_NEON_DATA_URL)
  const endpoint = httpsUrl(env.AWS_ENDPOINT_URL_S3)
  const databaseUrl = new URL(env.NEON_DATABASE_URL)
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) throw new Error('Invalid Neon database URL')
  databaseUrl.searchParams.set('sslmode', 'verify-full')

  const pool = database ?? new Pool({ connectionString: databaseUrl.href, max: 6, connectionTimeoutMillis: 15000, idleTimeoutMillis: 12000 })
  if (!database) pool.on('error', () => { console.error('Neon database connection lost.') })
  const storage = objectStorage ?? new S3Client({
    endpoint: endpoint.href, region: env.AWS_REGION, forcePathStyle: true,
    credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  })
  const object = (command, timeout = 12000) => storage.send(command, { abortSignal: AbortSignal.timeout(timeout) })
  let audioUploads = 0

  async function authenticate(authorization) {
    const url = new URL(`${dataUrl.href.replace(/\/$/, '')}/app_memberships`)
    url.searchParams.set('select', 'user_id,active')
    url.searchParams.set('limit', '2')
    const response = await call(url, { headers: { Authorization: authorization } })
    if (response.status === 401 || response.status === 403) return { status: 401, code: 'unauthorized' }
    if (!response.ok) return { status: 503, code: 'membership-unavailable' }
    const rows = await response.json()
    if (!Array.isArray(rows) || rows.length > 1) return { status: 503, code: 'membership-unavailable' }
    if (!rows.length || rows[0]?.active !== true) return { status: 403, code: 'inactive' }
    if (!uuid.test(rows[0].user_id)) return { status: 503, code: 'membership-unavailable' }
    return { id: rows[0].user_id }
  }

  async function reserveUsage(userId, kind, requestId) {
    const { rows } = await pool.query('select public.reserve_usage($1::uuid, $2::text, $3::uuid) as result', [userId, kind, requestId])
    if (typeof rows[0]?.result?.allowed !== 'boolean') throw new Error('quota-unavailable')
    return rows[0].result.allowed
  }

  async function storeAudio(userId, id, key, body) {
    const connection = await pool.connect()
    try {
      await connection.query('begin')
      const { rows } = await connection.query(`select h.id from public.voice_history h join public.app_memberships m using(user_id)
        where h.user_id=$1 and h.id=$2 and not h.deleted and m.active for share of h, m`, [userId, id])
      if (!rows.length) { await connection.query('rollback'); return false }
      try {
        await object(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'audio/wav', IfNoneMatch: '*' }))
      } catch (cause) {
        // The object key carries a verified digest, so a precondition failure is already uploaded.
        if (cause.$metadata?.httpStatusCode !== 412) throw cause
      }
      await connection.query('commit')
      return true
    } catch (cause) {
      await connection.query('rollback').catch(() => {})
      throw cause
    } finally { connection.release() }
  }

  async function voiceAudio(req, res, url, fail) {
    const match = audioRoute.exec(url.pathname)
    if (!match || !uuid.test(match[1]) || url.search || !['GET', 'PUT'].includes(req.method)) return false
    const [, id, hash] = match
    const userId = req.authUserId
    const key = `${userId}/${id}/${hash}.wav`
    if (req.method === 'PUT') {
      if (req.headers['content-type']?.split(';')[0].trim() !== 'audio/wav') { fail(res, 415, 'content-type'); return true }
      if (Number(req.headers['content-length']) > audioLimit) { fail(res, 413, 'audio-too-large'); return true }
      if (audioUploads >= concurrentAudioUploads) { fail(res, 429, 'audio-upload-busy'); return true }
      audioUploads++
      try {
        let size = 0
        const chunks = []
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          size += chunk.length
          if (size > audioLimit) { fail(res, 413, 'audio-too-large'); return true }
          chunks.push(chunk)
        }
        const body = Buffer.concat(chunks)
        if (!size || createHash('sha256').update(body).digest('hex') !== hash) { fail(res, 400, 'audio-digest'); return true }
        if (!(await storeAudio(userId, id, key, body))) { fail(res, 404, 'audio-not-found'); return true }
        res.writeHead(201, { 'cache-control': 'no-store' }).end()
      } finally {
        audioUploads--
      }
      return true
    }
    const { rows } = await pool.query(`select h.id from public.voice_history h join public.app_memberships m using(user_id)
      where h.user_id=$1 and h.id=$2 and not h.deleted and m.active`, [userId, id])
    if (!rows.length) { fail(res, 404, 'audio-not-found'); return true }
    try {
      const file = await object(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!file.Body) throw new Error('Missing audio body')
      res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'audio/wav',
        ...(file.ContentLength === undefined ? {} : { 'content-length': file.ContentLength }) })
      await pipeline(file.Body, res)
    } catch (cause) {
      if (cause.$metadata?.httpStatusCode !== 404) throw cause
      fail(res, 404, 'audio-not-found')
    }
    return true
  }

  async function cleanup(userId) {
    const { rows } = await pool.query(`select id from public.voice_history where user_id=$1 and deleted and cleanup_pending limit 20`, [userId])
    let cleaned = 0
    for (const { id } of rows) {
      const prefix = `${userId}/${id}/`
      let empty = false
      for (let page = 0; page < 10; page++) {
        const files = await object(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 100 }))
        const keys = (files.Contents ?? []).map(({ Key }) => Key)
        if (!keys.length) { empty = true; break }
        if (keys.some(key => !key?.startsWith(prefix) || !/^[a-f0-9]{64}\.wav$/.test(key.slice(prefix.length)))) throw new Error('Invalid audio path')
        const removed = await object(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true } }))
        if (removed.Errors?.length) throw new Error('Audio cleanup failed')
      }
      if (!empty) return { cleaned, remaining: true }
      await pool.query('update public.voice_history set cleanup_pending=false where user_id=$1 and id=$2 and deleted', [userId, id])
      cleaned++
    }
    return { cleaned, remaining: rows.length === 20 }
  }

  return { authenticate, reserveUsage, voiceAudio, cleanup, close() {
    if (!database) void pool.end().catch(() => {})
    if (!objectStorage) storage.destroy()
  } }
}
