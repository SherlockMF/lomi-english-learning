/**
 * Merge expansion-v6 chunks into per-batch vocabulary pack files.
 *
 * Reads chunk files ({category, subcategory, words[]}) from
 * data/vocabulary-packs/expansion-v6/chunks/, groups them by category, and
 * writes one pack per category with words + canonical lists + memberships
 * (subcategory carried from the chunk onto each membership).
 *
 * Usage:
 *   node scripts/buildExpansionPack.mjs [--categories campus,daily] [--out <file>]
 *   node scripts/buildExpansionPack.mjs --all
 *
 * The script refuses to build when validation reports errors; run
 * scripts/validateExpansionPack.mjs first.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPANSION_DIR = join(root, 'data', 'vocabulary-packs', 'expansion-v6')
const CHUNKS_DIR = join(EXPANSION_DIR, 'chunks')
const PACKS_DIR = join(EXPANSION_DIR, 'packs')
const VALIDATION_REPORT = join(EXPANSION_DIR, 'validation', 'latest-validation.json')
const EXPORTED_AT = '2026-11-20T00:00:00.000Z'

const LIST_CATALOG = [
  { id: 'list-daily', name: 'Daily Life', slug: 'daily' },
  { id: 'list-business', name: 'Business', slug: 'business' },
  { id: 'list-finance', name: 'Finance', slug: 'finance' },
  { id: 'list-accounting', name: 'Accounting', slug: 'accounting' },
  { id: 'list-campus', name: 'Campus & Academic', slug: 'campus' },
  { id: 'list-housing', name: 'Housing & Living', slug: 'housing' },
  { id: 'list-health', name: 'Health & Medical', slug: 'health' },
  { id: 'list-money', name: 'Money & Banking', slug: 'money' },
  { id: 'list-career', name: 'Career & Employment', slug: 'career' },
  { id: 'list-food', name: 'Food & Dining', slug: 'food' },
  { id: 'list-travel', name: 'Travel & Transport', slug: 'travel' },
  { id: 'list-government', name: 'Government & Documents', slug: 'government' },
  { id: 'list-emergency', name: 'Emergency & Safety', slug: 'emergency' },
  { id: 'list-shopping', name: 'Shopping & Consumption', slug: 'shopping' },
  { id: 'list-social', name: 'Social & Culture', slug: 'social' },
  { id: 'list-entertainment', name: 'Entertainment & Sports', slug: 'entertainment' },
  { id: 'list-digital', name: 'Digital Life', slug: 'digital' },
  { id: 'list-communication', name: 'Communication & Functions', slug: 'communication' },
  { id: 'list-cs', name: 'Computer Science', slug: 'cs' },
  { id: 'list-economics', name: 'Economics', slug: 'economics' },
  { id: 'list-math', name: 'Mathematics', slug: 'math' },
  { id: 'list-engineering', name: 'Engineering', slug: 'engineering' },
  { id: 'list-medicine', name: 'Medicine', slug: 'medicine' },
  { id: 'list-law', name: 'Law', slug: 'law' },
  { id: 'list-psychology', name: 'Psychology', slug: 'psychology' },
  { id: 'list-marketing', name: 'Marketing', slug: 'marketing' },
]
const LIST_IDS = new Map(LIST_CATALOG.map((list) => [list.slug, list.id]))
const CREATED_AT = '2026-08-10T00:00:00.000Z'

function canonicalLists() {
  return LIST_CATALOG.map((list) => ({
    ...list,
    description: '',
    category: list.slug,
    isSystem: true,
    createdAt: CREATED_AT,
  }))
}

function normalizeIdentity(word) {
  const semantic = (value) => String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
  return `${semantic(word.expression)}\u0000${semantic(word.senseKey)}`
}

function parseArgs() {
  const args = { categories: null, out: null, all: false }
  const argv = process.argv.slice(2)
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--categories') args.categories = argv[index + 1]?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
    else if (argv[index] === '--out') args.out = argv[index + 1]
    else if (argv[index] === '--all') args.all = true
  }
  if (!args.all && !args.categories?.length) {
    console.error('需要 --categories <逗号分隔> 或 --all')
    process.exit(2)
  }
  if (args.all) args.categories = null
  return args
}

function requireCleanValidation() {
  if (!existsSync(VALIDATION_REPORT)) {
    console.error('未找到校验报告；请先运行 node scripts/validateExpansionPack.mjs')
    process.exit(1)
  }
  const report = JSON.parse(readFileSync(VALIDATION_REPORT, 'utf8'))
  if (report.totals.errors > 0) {
    console.error(`校验报告存在 ${report.totals.errors} 个错误；先修复再构建。报告: ${VALIDATION_REPORT}`)
    process.exit(1)
  }
}

function loadChunks(categories) {
  const files = readdirSync(CHUNKS_DIR).filter((file) => file.endsWith('.json')).sort()
  const byCategory = new Map()
  for (const name of files) {
    const chunk = JSON.parse(readFileSync(join(CHUNKS_DIR, name), 'utf8'))
    if (categories && !categories.includes(chunk.category)) continue
    if (!LIST_IDS.has(chunk.category)) {
      console.error(`chunk ${name} 的 category "${chunk.category}" 没有对应系统词单`)
      process.exit(1)
    }
    if (!byCategory.has(chunk.category)) byCategory.set(chunk.category, [])
    byCategory.get(chunk.category).push({ name, chunk })
  }
  return byCategory
}

function buildPack(category, chunkEntries) {
  const words = []
  const byIdentity = new Map()
  const subcategoryByWordId = new Map()
  for (const { name, chunk } of chunkEntries) {
    for (const word of chunk.words) {
      const identity = normalizeIdentity(word)
      if (byIdentity.has(identity)) {
        console.error(`构建 ${category}: 重复义项 ${word.id} (${word.expression}) 来自 ${name}`)
        process.exit(1)
      }
      byIdentity.set(identity, word)
      subcategoryByWordId.set(word.id, chunk.subcategory)
      words.push(word)
    }
  }
  words.sort((left, right) => left.id.localeCompare(right.id))
  const listId = LIST_IDS.get(category)
  const memberships = words.map((word, index) => ({
    id: `membership-${word.id}-${category}`,
    wordId: word.id,
    listId,
    priority: word.priority,
    subcategory: subcategoryByWordId.get(word.id),
    sortOrder: index,
  }))
  return {
    version: 1,
    kind: 'vocabulary-pack',
    exportedAt: EXPORTED_AT,
    words,
    lists: canonicalLists(),
    memberships,
  }
}

function main() {
  const args = parseArgs()
  requireCleanValidation()
  mkdirSync(PACKS_DIR, { recursive: true })
  const byCategory = loadChunks(args.categories)
  const summary = []
  for (const [category, entries] of byCategory) {
    const pack = buildPack(category, entries)
    const out = args.out && byCategory.size === 1 ? join(root, args.out) : join(PACKS_DIR, `expansion-v6-${category}.json`)
    writeFileSync(out, `${JSON.stringify(pack)}\n`)
    summary.push({ category, words: pack.words.length, memberships: pack.memberships.length, out })
  }
  console.log(JSON.stringify(summary, null, 2))
}

main()
