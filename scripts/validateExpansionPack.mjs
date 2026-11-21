/**
 * Mechanical validation for expansion-v6 vocabulary chunks and packs.
 *
 * Checks word schema completeness, id/senseKey format, example and collocation
 * presence, zh gloss sanity, CEFR values, and cross-chunk duplication
 * (within the expansion and against the trusted v5.2 pack by lemma+POS).
 *
 * Usage:
 *   node scripts/validateExpansionPack.mjs [--chunks] [--pack <file>] [--report <out>]
 *
 * Default: validates every chunk under data/vocabulary-packs/expansion-v6/chunks/
 * and every pack under data/vocabulary-packs/expansion-v6/packs/.
 * Exits non-zero on any error; warnings do not affect the exit code.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPANSION_DIR = join(root, 'data', 'vocabulary-packs', 'expansion-v6')
const CHUNKS_DIR = join(EXPANSION_DIR, 'chunks')
const PACKS_DIR = join(EXPANSION_DIR, 'packs')
const REPORTS_DIR = join(EXPANSION_DIR, 'validation')
const TRUSTED_PACK = join(root, 'data', 'vocabulary-packs', 'trusted_v5_2_vocabulary_pack.json')

const CATEGORIES = new Set([
  'daily', 'business', 'finance', 'accounting',
  'campus', 'housing', 'health', 'money', 'career', 'food', 'travel',
  'government', 'emergency', 'shopping', 'social', 'entertainment',
  'digital', 'communication',
  'cs', 'economics', 'math', 'engineering', 'medicine', 'law', 'psychology', 'marketing',
])
const LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
const WORD_FIELDS = ['id', 'expression', 'lemma', 'senseKey', 'zhGloss', 'enDefinition', 'partOfSpeech', 'acceptedZhAnswers', 'acceptedEnVariants', 'examples', 'collocations', 'source', 'priority', 'status', 'usagePrompts', 'createdAt', 'updatedAt']
const ID_PATTERN = /^v6-[a-z]+-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}$/
const SENSE_PATTERN = /^v6:[a-z]+-[0-9a-f]{8}$/
const POS_PREFIX = /^ *(?:n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|interj|aux|mod)\. /
const TIMING = /2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/

const errors = []
const warnings = []

function error(file, message) { errors.push(`${file}: ${message}`) }
function warn(file, message) { warnings.push(`${file}: ${message}`) }

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
}

const IRREGULAR_STEMS = {
  ran: 'run', run: 'run', running: 'run', fed: 'feed', got: 'get', getting: 'get', gotten: 'get',
  taken: 'take', took: 'take', taking: 'take', thrown: 'throw', threw: 'throw', hid: 'hide', hidden: 'hide',
  gone: 'go', went: 'go', going: 'go', done: 'do', did: 'do', doing: 'do', made: 'make', making: 'make',
  said: 'say', saying: 'say', saw: 'see', seen: 'see', seeing: 'see', held: 'hold', holding: 'hold',
  kept: 'keep', keeping: 'keep', left: 'leave', leaving: 'leave', lost: 'lose', losing: 'lose',
  met: 'meet', meeting: 'meet', paid: 'pay', paying: 'pay', sold: 'sell', sent: 'send', sending: 'send',
  sat: 'sit', slept: 'sleep', spoke: 'speak', spoken: 'speak', stood: 'stand', standing: 'stand',
  told: 'tell', telling: 'tell', thought: 'think', thinking: 'think', woke: 'wake', woken: 'wake',
  wore: 'wear', worn: 'wear', won: 'win', winning: 'win', wrote: 'write', written: 'write', writing: 'write',
  ate: 'eat', eaten: 'eat', eating: 'eat', broke: 'break', broken: 'break', breaking: 'break',
  brought: 'bring', bringing: 'bring', bought: 'buy', buying: 'buy', caught: 'catch', catching: 'catch',
  snuck: 'sneak', sneaking: 'sneak', froze: 'freeze', frozen: 'freeze', freezing: 'freeze',
  sank: 'sink', sunk: 'sink', sinking: 'sink', sang: 'sing', sung: 'sing', singing: 'sing',
  swam: 'swim', swum: 'swim', swimming: 'swim', rang: 'ring', rung: 'ring', ringing: 'ring',
  sprang: 'spring', sprung: 'spring', stank: 'stink', stunk: 'stink', rode: 'ride', ridden: 'ride',
  riding: 'ride', drove: 'drive', driven: 'drive', driving: 'drive', withdrawing: 'withdraw',
  shook: 'shake', shaking: 'shake', shaken: 'shake', drew: 'draw', drawn: 'draw', drawing: 'draw',
  came: 'come', coming: 'come', cost: 'cost', fell: 'fall', fallen: 'fall', falling: 'fall',
  gave: 'give', given: 'give', giving: 'give', was: 'be', were: 'be', been: 'be', being: 'be',
  are: 'be', is: 'be', am: 'be', lay: 'lie', lying: 'lie', lied: 'lie',
  felt: 'feel', feeling: 'feel', fought: 'fight', fighting: 'fight', found: 'find', finding: 'find',
  flew: 'fly', flown: 'fly', flying: 'fly', forgot: 'forget', forgotten: 'forget', forgetting: 'forget',
  grew: 'grow', grown: 'grow', growing: 'grow', heard: 'hear', hearing: 'hear', known: 'know',
  knowing: 'know', laid: 'lay', laying: 'lay', lent: 'lend', lending: 'lend', rose: 'rise',
  risen: 'rise', rising: 'rise', swore: 'swear', sworn: 'swear', swept: 'sweep', sweeping: 'sweep',
  swung: 'swing', swinging: 'swing', hung: 'hang', hanging: 'hang', built: 'build', building: 'build',
  spent: 'spend', spending: 'spend', dealt: 'deal', dealing: 'deal', meant: 'mean',
}

function expandEnglishToken(rawToken) {
  const out = new Set()
  const push = (value) => { if (value && value.length >= 1) out.add(value) }
  // Possessives and quoted tokens: "bursar's" → bursar, "'correct" → correct.
  let token = rawToken.replace(/^'+|'+$/g, '')
  if (token.endsWith("'s")) push(token.slice(0, -2))
  push(token)
  const bare = token.endsWith("'s") ? token.slice(0, -2) : token
  if (IRREGULAR_STEMS[bare]) {
    push(IRREGULAR_STEMS[bare])
    return out
  }
  if (bare.length > 4 && /ied$/.test(bare)) {
    push(`${bare.slice(0, -3)}y`)
    return out
  }
  if (/ing$/.test(bare) && bare.length > 5) {
    const base = bare.slice(0, -3)
    push(base)
    push(`${base}e`)
    if (/(.)\1$/.test(base)) push(base.slice(0, -1))
    return out
  }
  if (/ed$/.test(bare) && bare.length > 4) {
    const base = bare.slice(0, -2)
    push(base)
    push(`${base}e`)
    if (/(.)\1$/.test(base)) push(base.slice(0, -1))
    return out
  }
  // Verb -s forms are ambiguous (takes → take, boxes → box): offer both strips.
  if (/es$/.test(bare) && bare.length > 3) push(bare.slice(0, -2))
  if (/s$/.test(bare) && bare.length > 3) push(bare.slice(0, -1))
  return out
}

function exampleMentionsTarget(example, word) {
  // Split on every non-letter so hyphenated/slash joined forms line up on both sides.
  const sentenceWords = example.en
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const sentenceStems = new Set()
  for (const sentenceWord of sentenceWords) {
    for (const stem of expandEnglishToken(sentenceWord)) sentenceStems.add(stem)
  }
  const candidates = [word.expression, word.lemma, ...(Array.isArray(word.acceptedEnVariants) ? word.acceptedEnVariants : [])]
  for (const variant of candidates) {
    if (typeof variant !== 'string' || !variant.trim()) continue
    const firstSubToken = variant.trim().toLocaleLowerCase('en-US').split(/[^a-z']+/).filter(Boolean)[0]
    if (!firstSubToken) continue
    for (const stem of expandEnglishToken(firstSubToken)) {
      if (sentenceStems.has(stem)) return true
    }
  }
  return false
}

function validateWord(word, file, index) {
  const label = `${file}[${index}]`
  const where = typeof word.expression === 'string' && word.expression ? `"${word.expression}"` : `#${index}`

  for (const field of WORD_FIELDS) {
    if (!(field in word)) error(label, `缺少字段 ${field}`)
  }
  if (typeof word.id !== 'string' || !ID_PATTERN.test(word.id)) error(label, `${where} id 不符合 v6-<category>-<slug>-<8hex> 格式`)
  if (typeof word.senseKey !== 'string' || !SENSE_PATTERN.test(word.senseKey)) error(label, `${where} senseKey 不符合 v6:<category>-<8hex> 格式`)
  if (typeof word.expression !== 'string' || !word.expression.trim()) error(label, `${where} expression 为空`)
  if (typeof word.lemma !== 'string' || !word.lemma.trim()) error(label, `${where} lemma 为空`)
  else if (word.lemma !== word.expression.trim().toLocaleLowerCase('en-US')) warn(label, `${where} lemma 与 expression 小写不一致`)
  if (typeof word.zhGloss !== 'string' || !word.zhGloss.trim()) error(label, `${where} zhGloss 为空`)
  else {
    if (POS_PREFIX.test(word.zhGloss)) error(label, `${where} zhGloss 带词性前缀: "${word.zhGloss.slice(0, 24)}"`)
    if (word.zhGloss.length > 60 && !/[？?！!]/.test(word.zhGloss)) warn(label, `${where} zhGloss 过长 (>60)`)
  }
  if (typeof word.enDefinition !== 'string' || word.enDefinition.trim().length < 8) error(label, `${where} enDefinition 缺失或过短`)
  if (typeof word.partOfSpeech !== 'string' || !word.partOfSpeech.trim()) error(label, `${where} partOfSpeech 为空`)
  if (!Array.isArray(word.acceptedZhAnswers) || word.acceptedZhAnswers.length === 0) error(label, `${where} acceptedZhAnswers 为空`)
  else {
    if (!word.acceptedZhAnswers.some((answer) => typeof answer === 'string' && answer.trim())) error(label, `${where} acceptedZhAnswers 含空白`)
    if (typeof word.zhGloss === 'string' && word.zhGloss.trim() && !word.acceptedZhAnswers.includes(word.zhGloss.trim())) {
      warn(label, `${where} acceptedZhAnswers 不含主 zhGloss`)
    }
  }
  if (!Array.isArray(word.acceptedEnVariants) || word.acceptedEnVariants.length === 0) error(label, `${where} acceptedEnVariants 为空`)
  if (!Array.isArray(word.examples) || word.examples.length < 2) error(label, `${where} 例句少于 2 条`)
  else {
    word.examples.forEach((example, exampleIndex) => {
      const exampleLabel = `${label}.examples[${exampleIndex}]`
      if (!example || typeof example.en !== 'string' || example.en.trim().length < 8) error(exampleLabel, '英文例句缺失或过短')
      if (!example || typeof example.zh !== 'string' || example.zh.trim().length < 4) error(exampleLabel, '中文例句缺失或过短')
      else if (!example.zh.includes('「')) warn(exampleLabel, '中文例句未用「」标注目标表达')
      if (example && typeof example.en === 'string' && word.expression
        && !exampleMentionsTarget(example, word)) {
        warn(exampleLabel, '英文例句疑似未包含目标词')
      }
    })
  }
  if (!Array.isArray(word.collocations) || word.collocations.length < 2) error(label, `${where} 搭配少于 2 条`)
  else if (word.collocations.some((value) => typeof value !== 'string' || !value.trim())) error(label, `${where} 搭配含空白项`)
  if (word.source !== 'seed') error(label, `${where} source 必须是 'seed'`)
  if (word.status !== 'active') error(label, `${where} status 必须是 'active'`)
  if (!Number.isFinite(word.priority) || word.priority < 1 || word.priority > 10) error(label, `${where} priority 超出 1-10`)
  if (!Array.isArray(word.usagePrompts) || word.usagePrompts.length !== 0) error(label, `${where} usagePrompts 必须为空数组（构建期生成）`)
  if (typeof word.createdAt !== 'string' || !TIMING.test(word.createdAt)) error(label, `${where} createdAt 非 ISO 时间`)
  if (typeof word.updatedAt !== 'string' || !TIMING.test(word.updatedAt)) error(label, `${where} updatedAt 非 ISO 时间`)
  if ('vocabularyLevel' in word && word.vocabularyLevel !== undefined && !LEVELS.has(word.vocabularyLevel)) {
    error(label, `${where} vocabularyLevel 必须是 A1-C2`)
  }
  if ('subcategory' in word) warn(label, `${where} 词内不应有 subcategory（属于 membership）`)
}

function validateChunk(chunk, file, seenIds, seenLemmaPos, trustedLemmas) {
  if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
    error(file, 'chunk 必须是对象')
    return { words: 0, category: '' }
  }
  const category = chunk.category
  if (!CATEGORIES.has(category)) error(file, `未知 category: ${category}`)
  if (typeof chunk.subcategory !== 'string' || !chunk.subcategory.trim()) error(file, '缺少 subcategory')
  if (!Array.isArray(chunk.words) || chunk.words.length === 0) {
    error(file, 'words 为空')
    return { words: 0, category }
  }
  const localSeen = new Map()
  for (let index = 0; index < chunk.words.length; index += 1) {
    const word = chunk.words[index]
    validateWord(word, file, index)
    if (category && typeof word.id === 'string' && !word.id.startsWith(`v6-${category}-`)) {
      error(file, `id 前缀与 category 不符: ${word.id}`)
    }
    if (typeof word.id === 'string') {
      if (seenIds.has(word.id)) error(file, `重复 id: ${word.id}`)
      seenIds.add(word.id)
    }
    if (category && typeof word.expression === 'string' && typeof word.partOfSpeech === 'string') {
      const key = `${category}\u0000${normalizeKey(word.expression)}\u0000${normalizeKey(word.partOfSpeech)}`
      const prior = localSeen.get(key)
      if (prior) error(file, `同分类内重复义项: "${word.expression}" (${word.partOfSpeech})，先前于 "${prior}"`)
      localSeen.set(key, file)
      if (seenLemmaPos.has(key)) {
        warn(file, `与既有词库同 lemma+POS: "${word.expression}" (${word.partOfSpeech}) — 需人工确认是不同义项`)
      }
      seenLemmaPos.add(key)
      const lemmaKey = normalizeKey(word.expression)
      if (trustedLemmas.has(lemmaKey)) {
        warn(file, `expression 在 v5.2 词库中已存在: "${word.expression}" — 确认是不同义项或删除`)
      }
    }
  }
  return { words: chunk.words.length, category }
}

function loadTrustedLemmas() {
  const lemmas = new Set()
  if (!existsSync(TRUSTED_PACK)) return lemmas
  const pack = JSON.parse(readFileSync(TRUSTED_PACK, 'utf8'))
  for (const word of pack.words ?? []) lemmas.add(normalizeKey(word.expression))
  return lemmas
}

function validatePacks(trustedLemmas) {
  const packStats = []
  if (!existsSync(PACKS_DIR)) return packStats
  const seenIds = new Set()
  const seenLemmaPos = new Set()
  for (const name of readdirSync(PACKS_DIR).filter((file) => file.endsWith('.json')).sort()) {
    const file = join(PACKS_DIR, name)
    const pack = JSON.parse(readFileSync(file, 'utf8'))
    if (pack.kind !== 'vocabulary-pack' || pack.version !== 1) error(name, 'pack kind/version 不正确')
    const wordCount = Array.isArray(pack.words) ? pack.words.length : 0
    for (let index = 0; index < wordCount; index += 1) validateWord(pack.words[index], name, index)
    if (!Array.isArray(pack.memberships)) error(name, '缺少 memberships')
    else {
      const wordIds = new Set((pack.words ?? []).map((word) => word.id))
      let missingSubcategory = 0
      for (const membership of pack.memberships) {
        if (!wordIds.has(membership.wordId)) error(name, `membership 引用未知词: ${membership.wordId}`)
        if (typeof membership.listId !== 'string' || !membership.listId.startsWith('list-')) error(name, `membership listId 非法: ${membership.listId}`)
        if (typeof membership.subcategory !== 'string' || !membership.subcategory.trim()) missingSubcategory += 1
      }
      if (missingSubcategory) warn(name, `${missingSubcategory} 条 membership 缺 subcategory`)
    }
    const categoryCounts = {}
    for (const word of pack.words ?? []) {
      const match = /^v6-([a-z]+)-/.exec(word.id ?? '')
      const category = match ? match[1] : '(unknown)'
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1
      const key = `${category}\u0000${normalizeKey(word.expression)}\u0000${normalizeKey(word.partOfSpeech)}`
      if (seenLemmaPos.has(key)) error(name, `pack 间重复义项: "${word.expression}" (${category})`)
      seenLemmaPos.add(key)
      if (typeof word.id === 'string') {
        if (seenIds.has(word.id)) error(name, `pack 间重复 id: ${word.id}`)
        seenIds.add(word.id)
      }
      if (trustedLemmas.has(normalizeKey(word.expression))) {
        warn(name, `expression 在 v5.2 词库中已存在: "${word.expression}"`)
      }
    }
    packStats.push({ file: basename(file), words: wordCount, memberships: pack.memberships?.length ?? 0, categoryCounts })
  }
  return packStats
}

function main() {
  const trustedLemmas = loadTrustedLemmas()
  const seenIds = new Set()
  const seenLemmaPos = new Set()
  const chunkStats = []

  if (existsSync(CHUNKS_DIR)) {
    for (const name of readdirSync(CHUNKS_DIR).filter((file) => file.endsWith('.json')).sort()) {
      const file = join(CHUNKS_DIR, name)
      let chunk
      try {
        chunk = JSON.parse(readFileSync(file, 'utf8'))
      } catch (parseError) {
        error(name, `JSON 解析失败: ${parseError.message}`)
        continue
      }
      const stats = validateChunk(chunk, name, seenIds, seenLemmaPos, trustedLemmas)
      chunkStats.push({ file: name, ...stats, subcategory: chunk?.subcategory })
    }
  }

  const packStats = validatePacks(trustedLemmas)

  mkdirSync(REPORTS_DIR, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    chunks: chunkStats,
    packs: packStats,
    totals: {
      chunkWords: chunkStats.reduce((sum, entry) => sum + entry.words, 0),
      packWords: packStats.reduce((sum, entry) => sum + entry.words, 0),
      errors: errors.length,
      warnings: warnings.length,
    },
    errors,
    warnings,
  }
  const reportPath = join(REPORTS_DIR, 'latest-validation.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log(JSON.stringify({
    chunkFiles: chunkStats.length,
    packFiles: packStats.length,
    chunkWords: report.totals.chunkWords,
    packWords: report.totals.packWords,
    errors: errors.length,
    warnings: warnings.length,
    reportPath,
  }, null, 2))
  if (errors.length) {
    console.error(errors.slice(0, 40).join('\n'))
    process.exit(1)
  }
}

main()
