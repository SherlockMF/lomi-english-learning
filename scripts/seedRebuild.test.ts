import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { expect, it } from 'vitest'

function withSeedFixture(check: (directory: string) => void) {
  const directory = resolve(mkdtempSync(join(tmpdir(), 'engstudy-seed-rebuild-')))
  if (dirname(directory) !== resolve(tmpdir()) || !directory.startsWith(`${resolve(tmpdir())}${sep}engstudy-seed-rebuild-`)) {
    throw new Error('Unexpected isolated build directory')
  }
  const fixtures = ['scripts/buildBundledSeedPack.mjs', 'scripts/buildBundledExpansionPack.mjs', 'scripts/lib/handcraftedSenses.mjs',
    'src/data/seedVocabulary.ts', 'data/vocabulary-packs/trusted_v5_2_vocabulary_pack.json']
  const reviewFile = 'data/vocabulary-packs/handcrafted-overlap-review.json'
  if (existsSync(reviewFile)) fixtures.push(reviewFile)
  try {
    for (const file of fixtures) {
      const destination = join(directory, file)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(resolve(file), destination)
    }
    // The expansion stage appends the v6 packs on top of the v5.2 build output.
    cpSync(resolve('data/vocabulary-packs/expansion-v6/packs'), join(directory, 'data/vocabulary-packs/expansion-v6/packs'), { recursive: true })
    mkdirSync(join(directory, 'public/data'), { recursive: true })
    check(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('rebuilds both published assets byte for byte and remains deterministic on a second run', () => {
  withSeedFixture((directory) => {
    const run = () => {
      execFileSync(process.execPath, [join(directory, 'scripts/buildBundledSeedPack.mjs')], { encoding: 'utf8' })
      execFileSync(process.execPath, [join(directory, 'scripts/buildBundledExpansionPack.mjs')], { encoding: 'utf8' })
    }
    const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
    const assets = ['bundledSeedWords.json', 'bundledSeedMemberships.json']
    run()
    const first = assets.map(name => hash(join(directory, 'public/data', name)))
    expect(first).toEqual(assets.map(name => hash(resolve('public/data', name))))
    run()
    expect(assets.map(name => hash(join(directory, 'public/data', name)))).toEqual(first)
  })
}, 30_000)

it('requires review if an approved source ID disappears from the trusted pack', () => {
  withSeedFixture((directory) => {
    const review = JSON.parse(readFileSync(join(directory, 'data/vocabulary-packs/handcrafted-overlap-review.json'), 'utf8'))
    const sourcePath = join(directory, 'data/vocabulary-packs/trusted_v5_2_vocabulary_pack.json')
    const pack = JSON.parse(readFileSync(sourcePath, 'utf8'))
    pack.words = pack.words.filter((word: { id: string }) => word.id !== review.entries[0].wordId)
    writeFileSync(sourcePath, JSON.stringify(pack))
    expect(() => execFileSync(process.execPath, [join(directory, 'scripts/buildBundledSeedPack.mjs')], { encoding: 'utf8', stdio: 'pipe' }))
      .toThrow(/review.*source|source.*review/i)
  })
})
