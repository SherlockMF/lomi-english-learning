import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { rolldown } from 'rolldown'
import { loadSeedPackFromDisk } from './lib/loadSeedPack.mjs'
import { SEED_CONTENT_REVISION } from '../src/data/seedContentRevision'
import { loadSeedPack } from '../src/data/seedVocabulary'
import { ALL_VOCABULARY_LISTS } from '../src/data/vocabularyLists'

describe('Node export entries', () => {
  it('keeps Node environment unchanged before the production build', () => {
    const env = { ...process.env }
    delete env.NODE_ENV
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      "import { loadSeedPackFromDisk } from './scripts/lib/loadSeedPack.mjs'; await loadSeedPackFromDisk(process.cwd()); console.log(!Object.hasOwn(process.env, 'NODE_ENV'));"],
    { cwd: process.cwd(), env, encoding: 'utf8' })
    expect(output.trim()).toBe('true')
  })

  it.each(['exportShareBundle.mjs', 'exportVocabularyArchive.mjs'])('links %s without missing exports', async (entry) => {
    const bundle = await rolldown({ input: resolve('scripts', entry), platform: 'node',
      external: (id) => id.startsWith('node:') || id === 'vite' })
    try { await expect(bundle.generate({ format: 'esm' })).resolves.toBeDefined() }
    finally { await bundle.close() }
  })

  it('loads the same complete seed on disk as the browser asset loader', async () => {
    const browserSeed = await loadSeedPack()
    const diskSeed = await loadSeedPackFromDisk(process.cwd())
    expect(diskSeed.words).toEqual(browserSeed.words)
    expect(diskSeed.memberships).toEqual(browserSeed.memberships)
    expect(diskSeed.lists).toEqual(ALL_VOCABULARY_LISTS)
    expect(diskSeed.revision).toBe(SEED_CONTENT_REVISION)
  })
})
