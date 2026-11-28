import type { DictionaryMeaning, DictionaryResult, ListSlug, SystemListSlug, VocabularyItem, Word, WordListItem } from '../domain/types'
import { ALL_VOCABULARY_LISTS, LIST_IDS } from '../data/vocabularyLists'
import { getDatabaseSession, hydrateWords, normalizeUserSettings, type UserDataSnapshot } from './db'
import { createInitialTracks } from './scheduler'
import { createSerialQueue } from './serialQueue'
import { inferCategoryFromDictionary } from './inferCategory'
import { planDictionaryDuplicateRepair } from './dictionaryDuplicateRepair'
import { escapeRegExp, expressionKey, uniqueStrings } from './text'
export { expressionKey } from './text'

export interface WordEntry {
  key: string
  expression: string
  senses: VocabularyItem[]
}

export interface DictionarySenseEdit {
  senseKey: string
  original: DictionaryMeaning
}

export function groupWordsByExpression(items: VocabularyItem[]): WordEntry[] {
  const entries = new Map<string, WordEntry>()
  for (const item of items) {
    const key = expressionKey(item.expression)
    const entry = entries.get(key)
    if (entry) entry.senses.push(item)
    else entries.set(key, { key, expression: item.expression.trim(), senses: [item] })
  }
  return [...entries.values()]
}

export function dictionarySenseKey(meaning: DictionaryMeaning) {
  return meaning.senseKey ?? `dictionary:${JSON.stringify([
    expressionKey(meaning.partOfSpeech), expressionKey(meaning.zhGloss ?? ''), expressionKey(meaning.definition),
  ])}`
}

function sameDefinition(word: Word, meaning: DictionaryMeaning) {
  return expressionKey(word.partOfSpeech) === expressionKey(meaning.partOfSpeech)
    && Boolean(meaning.definition.trim()) && expressionKey(word.enDefinition) === expressionKey(meaning.definition)
}

function matchesMeaning(word: Word, meaning: DictionaryMeaning, allowGlossFallback: boolean) {
  if (word.senseKey === dictionarySenseKey(meaning)) return true
  const gloss = expressionKey(meaning.zhGloss ?? '')
  const matchesGloss = [word.zhGloss, ...word.acceptedZhAnswers].some((answer) => expressionKey(answer) === gloss)
  if (word.senseKey.startsWith('dictionary:')) {
    if (dictionarySenseKey(meaning).startsWith('dictionary:youdao:')
      && word.senseKey.startsWith('dictionary:[')) {
      try {
        const original: unknown = JSON.parse(word.senseKey.slice('dictionary:'.length))
        if (Array.isArray(original) && original[0] === expressionKey(meaning.partOfSpeech)
          && original[1] === gloss && (allowGlossFallback || original[2] === expressionKey(meaning.definition))) return true
      } catch { /* A malformed legacy identity is not a source match. */ }
    }
    return sameDefinition(word, meaning) && (!gloss || !word.zhGloss.trim() || matchesGloss)
  }
  if (expressionKey(word.partOfSpeech) !== expressionKey(meaning.partOfSpeech)) return false
  return sameDefinition(word, meaning) || (allowGlossFallback && Boolean(gloss) && matchesGloss)
}

function dictionaryUsagePrompts(word: Pick<Word, 'id' | 'expression' | 'zhGloss' | 'examples'>): Word['usagePrompts'] {
  const example = word.examples.find((value) => value.en.trim())?.en
  const { id, expression, zhGloss } = word
  return example && expressionKey(example).includes(expressionKey(expression)) && zhGloss ? [
    { id: `${id}-cloze`, type: 'cloze', prompt: example.replace(new RegExp(escapeRegExp(expression), 'i'), '_____'),
      answer: expression, modelAnswer: example, checkpoints: [expression] },
    { id: `${id}-sentence`, type: 'sentence', prompt: `用 “${expression}” 表达“${zhGloss}”，写一个完整句子。`,
      modelAnswer: example, checkpoints: [expression] },
  ] : []
}

export function dictionaryWordId(expression: string, senseKey: string) {
  const identity = JSON.stringify([expressionKey(expression), senseKey])
  let first = 0xcbf29ce484222325n
  let second = 0x84222325cbf29ce4n
  for (const character of identity) {
    const code = BigInt(character.codePointAt(0)!)
    first = BigInt.asUintN(64, (first ^ code) * 0x100000001b3n)
    second = BigInt.asUintN(64, (second ^ code) * 0x100000001b3n)
  }
  return `dictionary-${first.toString(16).padStart(16, '0')}${second.toString(16).padStart(16, '0')}`
}

function dictionaryWord(result: DictionaryResult, meaning: DictionaryMeaning, now: string): Word {
  // Existing matches retain their IDs; new senses agree across browser installations.
  const id = dictionaryWordId(result.word, dictionarySenseKey(meaning))
  const example = meaning.example?.trim()
  const gloss = meaning.zhGloss?.trim() ?? ''
  const expression = result.word.trim()
  const word: Word = {
    id, expression, lemma: expressionKey(expression), senseKey: dictionarySenseKey(meaning),
    zhGloss: gloss, enDefinition: meaning.definition.trim(), partOfSpeech: meaning.partOfSpeech,
    acceptedZhAnswers: gloss ? [gloss] : [], acceptedEnVariants: [expression],
    examples: example ? [{ en: example, zh: meaning.exampleZh?.trim() ?? '' }] : [],
    collocations: meaning.collocations ?? [], synonyms: meaning.synonyms, antonyms: meaning.antonyms,
    source: 'dictionary', priority: 0, status: 'paused',
    ipaUk: result.ipaUk, ipaUs: result.ipaUs, audioUk: result.audioUk, audioUs: result.audioUs,
    usagePrompts: [],
    createdAt: now, updatedAt: now,
  }
  word.usagePrompts = dictionaryUsagePrompts(word)
  return word
}

const enqueueSave = createSerialQueue()

function planDictionarySenses(
  result: DictionaryResult,
  selectedIndices: number[],
  category: SystemListSlug | 'other' | 'auto',
  scenarioNote: string | undefined,
  snapshot: Pick<UserDataSnapshot, 'words' | 'memberships'>,
  preserveExistingTraining = false,
  preserveExistingTrainingIds?: ReadonlySet<string>,
  edits: DictionarySenseEdit[] = [],
) {
  const key = expressionKey(result.word)
  if (!key) throw new Error('词典没有返回有效的英文表达。')
  if (category === 'other' && !scenarioNote?.trim()) throw new Error('请填写自定义场景备注。')
  const existing = snapshot.words.filter((word) => expressionKey(word.expression) === key)
  const existingIds = new Set(existing.map((word) => word.id))
  const words = new Map<string, Word>()
  const newWords: Word[] = []
  const memberships: WordListItem[] = []
  const membershipKeys = new Set(snapshot.memberships.map((membership) => `${membership.wordId}:${membership.listId}`))
  const selected = new Set(selectedIndices)
  const assignedKeys = new Map<string, string>()
  const equivalentProviderWords = new Map<string, string>()
  const editsByKey = new Map(edits.map((edit) => [edit.senseKey, edit.original]))
  const glossSources = new Map<string, Set<string>>()
  for (const meaning of result.meanings) {
    const match = editsByKey.get(dictionarySenseKey(meaning)) ?? meaning
    const glossKey = JSON.stringify([expressionKey(match.partOfSpeech), expressionKey(match.zhGloss ?? '')])
    const sources = glossSources.get(glossKey) ?? new Set<string>()
    sources.add(dictionarySenseKey(meaning))
    glossSources.set(glossKey, sources)
  }
  const activatedIds = new Set<string>()
  const now = new Date().toISOString()
  for (const [index, meaning] of result.meanings.entries()) {
    if (!meaning.zhGloss?.trim() && !meaning.definition.trim()) continue
    const sourceKey = dictionarySenseKey(meaning)
    const originalMeaning = editsByKey.get(sourceKey)
    const match = originalMeaning ?? meaning
    const glossKey = JSON.stringify([expressionKey(match.partOfSpeech), expressionKey(match.zhGloss ?? '')])
    const available = existing.filter((candidate) => !assignedKeys.has(candidate.id) || assignedKeys.get(candidate.id) === sourceKey)
    const providerContent = sourceKey.startsWith('dictionary:youdao:')
      ? JSON.stringify([meaning.partOfSpeech, meaning.zhGloss, meaning.definition, meaning.example, meaning.exampleZh,
        meaning.collocations ?? [], meaning.synonyms, meaning.antonyms ?? []]) : undefined
    const equivalentId = providerContent ? equivalentProviderWords.get(providerContent) : undefined
    let word = existing.find((candidate) => candidate.id === equivalentId)
      ?? existing.find((candidate) => candidate.senseKey === sourceKey)
      ?? available.find((candidate) => sameDefinition(candidate, match) && matchesMeaning(candidate, match, false))
      ?? available.find((candidate) => matchesMeaning(candidate, match, glossSources.get(glossKey)?.size === 1
        && !result.meanings.some((other) => dictionarySenseKey(other) !== sourceKey
          && sameDefinition(candidate, editsByKey.get(dictionarySenseKey(other)) ?? other))))
    if (!word) {
      word = dictionaryWord(result, meaning, now)
      existing.push(word)
      newWords.push(word)
      words.set(word.id, word)
    } else if (originalMeaning) {
      const gloss = meaning.zhGloss?.trim() ?? ''
      const example = meaning.example?.trim()
      const previousGloss = expressionKey(word.zhGloss)
      const glossChanged = gloss !== (originalMeaning.zhGloss?.trim() ?? '')
      const exampleChanged = (example ?? '') !== (originalMeaning.example?.trim() ?? '')
      const exampleZhChanged = (meaning.exampleZh?.trim() ?? '') !== (originalMeaning.exampleZh?.trim() ?? '')
      const contentChanged = glossChanged || exampleChanged || exampleZhChanged
        || meaning.definition.trim() !== originalMeaning.definition.trim()
        || meaning.partOfSpeech.trim() !== originalMeaning.partOfSpeech.trim()
        || JSON.stringify(meaning.collocations ?? []) !== JSON.stringify(originalMeaning.collocations ?? [])
      let examples = word.examples
      if (exampleChanged && !example) examples = word.examples.slice(1)
      else if (exampleChanged || exampleZhChanged) {
        const en = exampleChanged ? example! : word.examples[0]?.en || originalMeaning.example?.trim()
        if (en) examples = [{ en, zh: exampleZhChanged ? meaning.exampleZh?.trim() ?? '' : word.examples[0]?.zh ?? '' }, ...word.examples.slice(1)]
      }
      const refreshUsage = !word.usagePrompts.length || JSON.stringify(word.usagePrompts) === JSON.stringify(dictionaryUsagePrompts(word))
      word = { ...word, zhGloss: glossChanged ? gloss : word.zhGloss,
        enDefinition: meaning.definition.trim() !== originalMeaning.definition.trim() ? meaning.definition.trim() : word.enDefinition,
        partOfSpeech: meaning.partOfSpeech.trim() !== originalMeaning.partOfSpeech.trim() ? meaning.partOfSpeech.trim() : word.partOfSpeech,
        acceptedZhAnswers: glossChanged ? uniqueStrings([gloss, ...word.acceptedZhAnswers.filter((answer) => expressionKey(answer) !== previousGloss)]) : word.acceptedZhAnswers,
        examples, collocations: JSON.stringify(meaning.collocations ?? []) !== JSON.stringify(originalMeaning.collocations ?? [])
          ? meaning.collocations ?? [] : word.collocations,
        contentEdited: contentChanged || (word.contentEdited ?? word.updatedAt !== word.createdAt), updatedAt: now }
      if (refreshUsage) word.usagePrompts = dictionaryUsagePrompts(word)
      const wordId = word.id
      existing[existing.findIndex((candidate) => candidate.id === wordId)] = word
      words.set(word.id, word)
    } else if (word.source === 'dictionary') {
      if (meaning.supersededDefinition && word.enDefinition === meaning.supersededDefinition) {
        word = { ...word, enDefinition: meaning.definition.trim(), updatedAt: now }
        const correctedId = word.id
        existing[existing.findIndex((candidate) => candidate.id === correctedId)] = word
        words.set(word.id, word)
      }
      if (sourceKey.startsWith('dictionary:youdao:') && word.senseKey !== sourceKey && !assignedKeys.has(word.id)) {
        word = { ...word, senseKey: sourceKey, updatedAt: now }
        const migratedId = word.id
        existing[existing.findIndex((candidate) => candidate.id === migratedId)] = word
        words.set(word.id, word)
      }
      // Fill missing source data without replacing an edited definition or review history.
      const gloss = meaning.zhGloss?.trim() ?? ''
      const example = meaning.example?.trim()
      if ((!word.zhGloss && gloss) || (!word.enDefinition && meaning.definition.trim())
        || (!word.examples.length && example) || (!word.collocations.length && meaning.collocations?.length)) {
        word = { ...word, zhGloss: word.zhGloss || gloss,
          acceptedZhAnswers: word.zhGloss || !gloss ? word.acceptedZhAnswers : [...new Set([...word.acceptedZhAnswers, gloss])],
          enDefinition: word.enDefinition || meaning.definition.trim(),
          examples: word.examples.length || !example ? word.examples : [{ en: example, zh: meaning.exampleZh?.trim() ?? '' }],
          collocations: word.collocations.length ? word.collocations : meaning.collocations ?? [], updatedAt: now }
        if (!word.usagePrompts.length) word.usagePrompts = dictionaryUsagePrompts(word)
        const wordId = word.id
        existing[existing.findIndex((candidate) => candidate.id === wordId)] = word
        words.set(word.id, word)
      }
    }
    if (!assignedKeys.has(word.id)) assignedKeys.set(word.id, sourceKey)
    if (providerContent) equivalentProviderWords.set(providerContent, word.id)
    const preserveTraining = preserveExistingTraining && (preserveExistingTrainingIds ?? existingIds).has(word.id)
    const shouldStudy = selected.has(index) && Boolean(word.zhGloss.trim()) && !preserveTraining
    if (shouldStudy) {
      activatedIds.add(word.id)
      if (word.status !== 'active' || word.knownAt) {
        const updated: Word = { ...word, status: 'active', knownAt: undefined, updatedAt: now }
        existing[existing.findIndex((candidate) => candidate.id === updated.id)] = updated
        word = updated
        words.set(word.id, word)
      }
    }
    const inferred = category === 'auto'
      ? inferCategoryFromDictionary(word.expression, `${word.enDefinition} ${word.zhGloss}`, word.partOfSpeech) ?? 'daily'
      : category
    const keepExistingCategory = (category === 'auto' && existingIds.has(word.id) || preserveTraining)
      && snapshot.memberships.some((membership) => membership.wordId === word.id)
    const slugs: ListSlug[] = inferred === 'other' ? ['my-vocabulary']
      : [...(keepExistingCategory ? [] : [inferred]), ...(shouldStudy ? ['my-vocabulary' as const] : [])]
    for (const slug of slugs) {
      const membershipKey = `${word.id}:${LIST_IDS[slug]}`
      if (membershipKeys.has(membershipKey)) continue
      membershipKeys.add(membershipKey)
      memberships.push({ id: `membership-${word.id}-${slug}`, wordId: word.id, listId: LIST_IDS[slug],
        priority: word.priority, sortOrder: index, subcategory: category === 'other' ? scenarioNote?.trim() : undefined })
    }
  }
  return { words: [...words.values()], memberships, added: newWords.length, activated: activatedIds.size, total: result.meanings.length }
}

/** Archive the source's senses; activate only an explicit selection, preserving old progress. */
export function saveDictionarySenses(
  result: DictionaryResult,
  selectedIndices: number[],
  category: SystemListSlug | 'other' | 'auto',
  scenarioNote?: string,
  options?: { preserveExistingTraining?: boolean; preserveExistingTrainingIds?: ReadonlySet<string>; edits?: DictionarySenseEdit[] },
) {
  const database = getDatabaseSession()
  return enqueueSave(async () => {
    const transaction = await database.transaction(['words', 'wordListItems', 'tracks'], 'readwrite')
    const words = transaction.objectStore('words')
    const memberships = transaction.objectStore('wordListItems')
    const tracks = transaction.objectStore('tracks')
    async function save() {
      const [existingWords, existingMemberships, existingTracks] = await Promise.all([
        words.getAll(), memberships.getAll(), tracks.getAll(),
      ])
      const planned = planDictionarySenses(result, selectedIndices, category, scenarioNote,
        { words: existingWords, memberships: existingMemberships },
        options?.preserveExistingTraining, options?.preserveExistingTrainingIds, options?.edits)
      if (planned.words.length || planned.memberships.length) {
        const trackKeys = new Set(existingTracks.map(track => `${track.itemId}:${track.type}`))
        const newTracks = createInitialTracks(planned.words).filter(track => !trackKeys.has(`${track.itemId}:${track.type}`))
        await Promise.all([
          ...planned.words.map(word => words.put(word)),
          ...planned.memberships.map(membership => memberships.put(membership)),
          ...newTracks.map(track => tracks.put(track)),
        ])
      }
      return { added: planned.added, activated: planned.activated, total: planned.total }
    }
    const [summary] = await Promise.all([save(), transaction.done])
    return summary
  })
}

export interface BundledDictionarySenses {
  revision: string
  results: DictionaryResult[]
}

/** One incremental transaction; never resurrect deleted entries or rewrite existing seed content. */
export function applyBundledDictionarySenses(pack: BundledDictionarySenses) {
  const database = getDatabaseSession()
  return enqueueSave(async () => {
    // Reading and writing in the same transaction also serializes separate tabs.
    const transaction = await database.transaction(['words', 'vocabularyLists', 'wordListItems', 'tracks', 'attempts', 'settings'], 'readwrite')
    const [existingWords, existingMemberships, existingTracks, storedSettings, lists, attempts] = await Promise.all([
      transaction.objectStore('words').getAll(),
      transaction.objectStore('wordListItems').getAll(),
      transaction.objectStore('tracks').getAll(),
      transaction.objectStore('settings').get('primary'),
      transaction.objectStore('vocabularyLists').getAll(),
      transaction.objectStore('attempts').getAll(),
    ])
    let snapshot = { words: existingWords, memberships: existingMemberships, tracks: existingTracks,
      settings: normalizeUserSettings(storedSettings ?? {}),
      vocabulary: hydrateWords(existingWords, existingMemberships, lists.length ? lists : ALL_VOCABULARY_LISTS) }
    if (snapshot.settings.dictionaryContentRevision === pack.revision) {
      await transaction.done
      return { added: 0 }
    }
    // Repair only the affected import revisions and their untouched duplicates.
    // Earlier, edited or learned records survive both source-identity migrations.
    if (['2c1c8200cf3a82da', 'baca46435dadeabc', '1-97e81d75ace99ced', '2-97e81d75ace99ced'].includes(snapshot.settings.dictionaryContentRevision ?? '')) {
      const identities = new Set(pack.results.flatMap((result) => result.meanings.map((meaning) =>
        `${expressionKey(result.word)}\u0000${dictionarySenseKey(meaning)}`)))
      const providerGlosses = new Set(pack.results.flatMap((result) => result.meanings
        .filter((meaning) => dictionarySenseKey(meaning).startsWith('dictionary:youdao:'))
        .map((meaning) => JSON.stringify([expressionKey(result.word), expressionKey(meaning.partOfSpeech), expressionKey(meaning.zhGloss ?? '')]))))
      for (const word of snapshot.words) {
        if (!word.senseKey.startsWith('dictionary:[')) continue
        try {
          const original: unknown = JSON.parse(word.senseKey.slice('dictionary:'.length))
          if (Array.isArray(original) && providerGlosses.has(JSON.stringify([word.lemma, original[0], original[1]]))) {
            identities.add(`${word.lemma}\u0000${word.senseKey}`)
          }
        } catch { /* Invalid legacy keys are excluded from duplicate repair. */ }
      }
      const providerMigration = ['1-97e81d75ace99ced', '2-97e81d75ace99ced'].includes(snapshot.settings.dictionaryContentRevision ?? '')
      const aliases = providerMigration ? new Map<string, string>() : undefined
      if (aliases) {
        const canonicalSources = new Set(providerGlosses)
        for (const word of snapshot.words) {
          const prefix = word.senseKey.startsWith('dictionary:youdao:') ? 'dictionary:youdao:' : 'dictionary:'
          if (!word.senseKey.startsWith(`${prefix}[`)) continue
          try {
            const source: unknown = JSON.parse(word.senseKey.slice(prefix.length))
            if (!Array.isArray(source)) continue
            const canonical = JSON.stringify([word.lemma, source[0], source[1]])
            if (!canonicalSources.has(canonical)) continue
            aliases.set(`${word.lemma}\u0000${word.senseKey}`, canonical)
            identities.add(canonical)
          } catch { /* Invalid source identities are excluded from migration repair. */ }
        }
      }
      const repair = planDictionaryDuplicateRepair({ ...snapshot, attempts }, identities,
        providerMigration ? '2026-10-13T02:25:45.000Z' : '2026-10-11T01:57:30.188Z', aliases)
      const removed = new Set(repair.wordIds)
      for (const id of repair.wordIds) transaction.objectStore('words').delete(id)
      for (const id of repair.trackIds) transaction.objectStore('tracks').delete(id)
      for (const id of repair.membershipIds) transaction.objectStore('wordListItems').delete(id)
      const remainingWords = snapshot.words.filter((word) => !removed.has(word.id))
      const remainingMemberships = snapshot.memberships.filter((membership) => !removed.has(membership.wordId))
      snapshot = { ...snapshot, words: remainingWords, memberships: remainingMemberships,
        tracks: snapshot.tracks.filter((track) => !removed.has(track.itemId)),
        vocabulary: hydrateWords(remainingWords, remainingMemberships, lists.length ? lists : ALL_VOCABULARY_LISTS) }
    }
    const entries = new Map(groupWordsByExpression(snapshot.vocabulary).map((entry) => [entry.key, entry]))
    const rawWords = new Map(snapshot.words.map((word) => [word.id, word]))
    const membershipsByWord = new Map<string, WordListItem[]>()
    for (const membership of snapshot.memberships) {
      const bucket = membershipsByWord.get(membership.wordId) ?? []
      bucket.push(membership)
      membershipsByWord.set(membership.wordId, bucket)
    }
    const words = new Map<string, Word>()
    const memberships: WordListItem[] = []
    let added = 0
    for (const result of pack.results) {
      const entry = entries.get(expressionKey(result.word))
      if (!entry) continue
      const primary = entry.senses[0]
      const category = primary.category === 'my-vocabulary'
        ? primary.scenarioNote?.trim() ? 'other' : 'daily'
        : primary.category
      const planned = planDictionarySenses(result, [], category, primary.scenarioNote, {
        words: entry.senses.map((word) => rawWords.get(word.id)!),
        memberships: entry.senses.flatMap((word) => membershipsByWord.get(word.id) ?? []),
      })
      for (const word of planned.words) words.set(word.id, word)
      memberships.push(...planned.memberships)
      added += planned.added
    }
    const trackKeys = new Set(snapshot.tracks.map((track) => `${track.itemId}:${track.type}`))
    const tracks = createInitialTracks([...words.values()]).filter((track) => !trackKeys.has(`${track.itemId}:${track.type}`))
    for (const word of words.values()) transaction.objectStore('words').put(word)
    for (const membership of memberships) transaction.objectStore('wordListItems').put(membership)
    for (const track of tracks) transaction.objectStore('tracks').put(track)
    transaction.objectStore('settings').put({ ...snapshot.settings, dictionaryContentRevision: pack.revision })
    await transaction.done
    return { added }
  })
}
