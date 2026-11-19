import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const migrations = resolve(dirname(scriptPath), '../supabase/migrations')

export async function readNeonSchema() {
  const [cloud, voice] = await Promise.all([
    readFile(join(migrations, '202610230001_cloud.sql'), 'utf8'),
    readFile(join(migrations, '202611020001_voice_history.sql'), 'utf8'),
  ])

  // Neon stores audio in an S3 bucket. Keep the permission RPC used by the app server.
  const audioFunction = voice.indexOf('create function public.voice_audio_allowed(')
  const bucketInsert = voice.indexOf('insert into storage.buckets(')
  const storagePolicies = voice.indexOf('create policy voice_audio_read on storage.objects')
  if (bucketInsert < 0 || audioFunction <= bucketInsert || storagePolicies <= audioFunction) {
    throw new Error('The voice migration no longer has the expected Storage sections')
  }

  const postgres = [cloud, voice.slice(0, bucketInsert) + voice.slice(audioFunction, storagePolicies) + 'commit;']
    .map(sql => sql.trim().replace(/^begin;\s*/i, '').replace(/\s*commit;$/i, ''))
    .join('\n\n')
    .replaceAll('auth.users(id)', 'neon_auth."user"(id)')
    .replaceAll('auth.uid()', '(auth.user_id())::uuid')
    .replace(/\banon\b/g, 'anonymous')
    .replace(/\bservice_role\b/g, 'current_user')

  return `begin;\ngrant usage on schema public to authenticated;\n${postgres}\ncommit;\n`
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  process.stdout.write(await readNeonSchema())
}
