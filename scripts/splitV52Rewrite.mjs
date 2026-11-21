/**
 * Split trusted_v5_2_vocabulary_pack.json into example-rewrite work files.
 * Each work file holds ~380 words grouped by primary category, preserving the
 * full word objects so agents can rewrite examples in place and the merger
 * can write them back by id.
 *
 * Output: data/vocabulary-packs/v52-example-rewrite/work-<nn>-<category>.json
 * Run: node scripts/splitV52Rewrite.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packPath = join(root, 'data', 'vocabulary-packs', 'trusted_v5_2_vocabulary_pack.json')
const outDir = join(root, 'data', 'vocabulary-packs', 'v52-example-rewrite')

const pack = JSON.parse(readFileSync(packPath, 'utf8'))
const LIST_SLUGS = ['daily', 'business', 'finance', 'accounting']
const byWord = new Map()
for (const membership of pack.memberships ?? []) {
  byWord.set(membership.wordId, [...(byWord.get(membership.wordId) ?? []), membership.listId])
}
const slugOf = (listId) => String(listId ?? '').replace(/^list-/, '')
function primaryCategory(wordId) {
  const slugs = (byWord.get(wordId) ?? []).map(slugOf)
  for (const slug of LIST_SLUGS) {
    if (slugs.includes(slug)) return slug
  }
  return 'daily'
}

const groups = new Map()
for (const word of pack.words) {
  const category = primaryCategory(word.id)
  if (!groups.has(category)) groups.set(category, [])
  groups.get(category).push(word)
}

const TARGET = 380
const files = []
let serial = 1
for (const [category, words] of [...groups.entries()].sort()) {
  for (let offset = 0; offset < words.length; offset += TARGET) {
    const slice = words.slice(offset, offset + TARGET)
    const name = `work-${String(serial).padStart(2, '0')}-${category}.json`
    files.push({ name, category, words: slice.length })
    writeFileSync(join(outDir, name), `${JSON.stringify({ category, words: slice })}\n`)
    serial += 1
  }
}

mkdirSync(dirname(join(outDir, 'manifest.json')), { recursive: true })
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), source: 'trusted_v5_2_vocabulary_pack.json', totalWords: pack.words.length, files }, null, 2)}\n`)
console.log(JSON.stringify({ files: files.length, total: pack.words.length, perFile: files }, null, 1))
