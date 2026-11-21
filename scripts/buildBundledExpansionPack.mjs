/**
 * Merge the trusted v5.2 bundled seed with expansion-v6 packs into the
 * bundled seed files consumed by the app at first run / revision refresh.
 *
 * Input:
 *   public/data/bundledSeedWords.json        (v5.2 words, already transformed)
 *   public/data/bundledSeedMemberships.json  (v5.2 memberships)
 *   data/vocabulary-packs/expansion-v6/packs/expansion-v6-<category>.json (26 packs)
 *
 * Output (compact JSON):
 *   public/data/bundledSeedWords.json        (v5.2 + expansion, usagePrompts generated)
 *   public/data/bundledSeedMemberships.json  (v5.2 + expansion memberships)
 *
 * Run: node scripts/buildBundledExpansionPack.mjs
 * Bump SEED_CONTENT_REVISION (src/data/seedContentRevision.ts) afterwards.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wordsPath = join(root, 'public', 'data', 'bundledSeedWords.json')
const membershipsPath = join(root, 'public', 'data', 'bundledSeedMemberships.json')
const packsDir = join(root, 'data', 'vocabulary-packs', 'expansion-v6', 'packs')

function semanticPart(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
}

function identity(word) {
  return `${semanticPart(word.expression)}\u0000${semanticPart(word.senseKey)}`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Cloze prompt over the first example, matching the expression or a listed variant. */
function buildUsagePrompts(wordId, word) {
  const exampleEn = (Array.isArray(word.examples) && word.examples[0]?.en) || ''
  const candidates = [word.expression, ...(word.acceptedEnVariants ?? [])]
    .map((value) => String(value).trim())
    .filter(Boolean)
  let matchedForm = ''
  let sample = exampleEn
  if (exampleEn) {
    for (const candidate of candidates) {
      const re = new RegExp(escapeRegExp(candidate), 'i')
      if (re.test(exampleEn)) {
        matchedForm = (exampleEn.match(re) ?? [candidate])[0]
        break
      }
    }
  }
  if (!sample) sample = `I used ${word.expression} in a real situation.`
  const clozeSource = matchedForm
    ? sample.replace(new RegExp(escapeRegExp(matchedForm), 'i'), '_____')
    : sample
  const answer = matchedForm || word.expression
  return [
    {
      id: `${word.id}-cloze`,
      type: 'cloze',
      prompt: `Complete: ${clozeSource}`,
      answer,
      modelAnswer: sample,
      checkpoints: [answer],
    },
    {
      id: `${word.id}-sentence`,
      type: 'sentence',
      prompt: `用 “${word.expression}” 写一句你真实会说的话。`,
      modelAnswer: sample,
      checkpoints: [word.expression],
    },
  ]
}

function main() {
  // Idempotency: strip any previously merged v6 words so the packs are the
  // single source of truth for expansion content.
  const rawWords = JSON.parse(readFileSync(wordsPath, 'utf8'))
  const rawMemberships = JSON.parse(readFileSync(membershipsPath, 'utf8'))
  const isExpansion = (word) => String(word.id ?? '').startsWith('v6-')
  const existingWords = rawWords.filter((word) => !isExpansion(word))
  const existingMemberships = rawMemberships.filter((m) => !String(m.wordId ?? '').startsWith('v6-'))
  const byIdentity = new Map(existingWords.map((word) => [identity(word), word]))
  const membershipKeys = new Set(existingMemberships.map((m) => `${m.wordId}\u0000${m.listId}`))

  const packFiles = readdirPackFiles()
  const addedWords = []
  const addedMemberships = []
  const skipped = []
  const perCategory = {}

  for (const file of packFiles) {
    const pack = JSON.parse(readFileSync(join(packsDir, file), 'utf8'))
    if (pack.kind !== 'vocabulary-pack' || pack.version !== 1) throw new Error(`${file}: pack kind/version 不正确`)
    const category = file.replace(/^expansion-v6-/, '').replace(/\.json$/, '')
    for (const word of pack.words) {
      const key = identity(word)
      if (byIdentity.has(key)) {
        skipped.push(`${word.id} (${word.expression}) 与既有种子同 identity`)
        continue
      }
      byIdentity.set(key, word)
      const bundled = { ...word, usagePrompts: buildUsagePrompts(word.id, word) }
      delete bundled.knownAt
      addedWords.push(bundled)
      perCategory[category] = (perCategory[category] ?? 0) + 1
    }
    for (const membership of pack.memberships ?? []) {
      const key = `${membership.wordId}\u0000${membership.listId}`
      if (membershipKeys.has(key)) continue
      membershipKeys.add(key)
      addedMemberships.push(membership)
    }
  }

  const words = [...existingWords, ...addedWords]
  const memberships = [...existingMemberships, ...addedMemberships]

  writeFileSync(wordsPath, `${JSON.stringify(words)}\n`)
  writeFileSync(membershipsPath, `${JSON.stringify(memberships)}\n`)

  console.log(JSON.stringify({
    v5_2Words: existingWords.length,
    expansionWords: addedWords.length,
    totalWords: words.length,
    memberships: memberships.length,
    skippedIdentityCollisions: skipped.length,
    perCategory,
    skippedSample: skipped.slice(0, 5),
  }, null, 2))
}

function readdirPackFiles() {
  return readdirSync(packsDir).filter((f) => f.endsWith('.json')).sort()
}

main()
