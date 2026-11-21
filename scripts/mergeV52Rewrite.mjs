/**
 * Merge rewritten example work files back into trusted_v5_2_vocabulary_pack.json.
 *
 * For every word id present in the work files, copies the rewritten fields
 * (examples, plus optional zhGloss / enDefinition / acceptedZhAnswers /
 * collocations changes) onto the pack word, then rewrites the pack in place
 * (compact JSON). Words not present in any work file are left untouched.
 *
 * Run: node scripts/mergeV52Rewrite.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packPath = join(root, 'data', 'vocabulary-packs', 'trusted_v5_2_vocabulary_pack.json')
const workDir = join(root, 'data', 'vocabulary-packs', 'v52-example-rewrite')
const dryRun = process.argv.includes('--dry-run')


const pack = JSON.parse(readFileSync(packPath, 'utf8'))
const packById = new Map(pack.words.map((word) => [word.id, word]))

const workFiles = readdirSync(workDir).filter((f) => /^work-\d+-[a-z]+\.json$/.test(f)).sort()
const stats = { files: 0, wordsSeen: 0, wordsChanged: 0, examplesReplaced: 0, glossChanged: [], definitionChanged: 0, missingInPack: [] }
const seenIds = new Set()

for (const file of workFiles) {
  const work = JSON.parse(readFileSync(join(workDir, file), 'utf8'))
  stats.files += 1
  for (const word of work.words) {
    if (seenIds.has(word.id)) throw new Error(`重复词条 id: ${word.id} (${file})`)
    seenIds.add(word.id)
    stats.wordsSeen += 1
    const target = packById.get(word.id)
    if (!target) {
      stats.missingInPack.push(`${word.id} (${file})`)
      continue
    }
    let changed = false
    if (Array.isArray(word.examples) && word.examples.length === 2) {
      if (JSON.stringify(word.examples) !== JSON.stringify(target.examples)) {
        target.examples = word.examples
        stats.examplesReplaced += 1
        changed = true
      }
    }
    if (typeof word.zhGloss === 'string' && word.zhGloss.trim() && word.zhGloss !== target.zhGloss) {
      stats.glossChanged.push(`${target.expression}: ${target.zhGloss} → ${word.zhGloss}`)
      target.zhGloss = word.zhGloss
      changed = true
    }
    if (typeof word.enDefinition === 'string' && word.enDefinition.trim() && word.enDefinition !== target.enDefinition) {
      target.enDefinition = word.enDefinition
      stats.definitionChanged += 1
      changed = true
    }
    for (const field of ['acceptedZhAnswers', 'acceptedEnVariants', 'collocations', 'usagePrompts']) {
      if (Array.isArray(word[field]) && word[field].length && JSON.stringify(word[field]) !== JSON.stringify(target[field])) {
        target[field] = word[field]
        changed = true
      }
    }
    if (changed) stats.wordsChanged += 1
  }
}

console.log(JSON.stringify({ ...stats, dryRun }, null, 2))
if (stats.missingInPack.length) console.error('缺失词条样例:', stats.missingInPack.slice(0, 5))
if (!dryRun) {
  writeFileSync(packPath, `${JSON.stringify(pack)}\n`)
  console.log('pack 已写回:', packPath)
}
