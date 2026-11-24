import {
  type LearningTrack,
  type VocabularyList,
  type VocabularyPackV1,
  type Word,
  type WordListItem,
} from '../domain/types'
import { ALL_VOCABULARY_LISTS, LIST_IDS } from '../data/vocabularyLists'
import {
  BackupValidationError,
  validateVocabularyList,
  validateWord,
  validateWordListItem,
} from './backup'
import { getUserDataSnapshot, writeBatch } from './db'
import { createInitialTracks } from './scheduler'

type UnknownRecord = Record<string, unknown>

export interface VocabularyPackImportSummary {
  added: number
  updated: number
  unchanged: number
  membershipsAdded: number
}

function fail(path: string, message: string): never {
  throw new BackupValidationError(path, message)
}

function objectAt(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, '必须是对象')
  }
  const record = value as UnknownRecord
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, '不支持的字段')
  }
  return record
}

function dateAt(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(path, '必须是非空字符串')
  }
  if (!value.includes('T') || Number.isNaN(Date.parse(value))) {
    fail(path, '必须是有效的 ISO 日期时间')
  }
}

function arrayAt<T>(
  value: unknown,
  path: string,
  validate: (entry: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) fail(path, '必须是数组')
  const result: T[] = []
  for (let index = 0; index < value.length; index += 1) {
    result.push(validate(value[index], `${path}[${index}]`))
  }
  return result
}

function decodeInput(input: unknown): unknown {
  if (typeof input !== 'string') return input
  try {
    return JSON.parse(input) as unknown
  } catch {
    fail('$', '不是有效的 JSON')
  }
}

function semanticPart(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
}

export function wordIdentity(word: Pick<Word, 'expression' | 'senseKey'>): string {
  return `${semanticPart(word.expression)}\u0000${semanticPart(word.senseKey)}`
}

function preferWord(left: Word, right: Word): Word {
  return Date.parse(right.updatedAt) > Date.parse(left.updatedAt) ? right : left
}

function isBlankText(value: string | undefined) {
  return !value || value.trim().length === 0
}

function isEmptyList(value: readonly unknown[] | undefined) {
  return !value || value.length === 0
}

/** Fill empty enrichment fields from a pack word; never overwrite local content. */
export function enrichLocalWordFromPack(local: Word, pack: Word): { word: Word; changed: boolean } {
  const next: Word = { ...local }
  let changed = false

  const fillText = <K extends 'enDefinition' | 'partOfSpeech' | 'ipaUk' | 'ipaUs' | 'audioUk' | 'audioUs'>(
    key: K,
  ) => {
    if (isBlankText(next[key]) && !isBlankText(pack[key])) {
      next[key] = pack[key]
      changed = true
    }
  }

  fillText('enDefinition')
  fillText('partOfSpeech')
  fillText('ipaUk')
  fillText('ipaUs')
  fillText('audioUk')
  fillText('audioUs')

  if (isEmptyList(next.examples) && !isEmptyList(pack.examples)) {
    next.examples = pack.examples
    changed = true
  }
  if (isEmptyList(next.collocations) && !isEmptyList(pack.collocations)) {
    next.collocations = pack.collocations
    changed = true
  }
  if (isEmptyList(next.synonyms) && !isEmptyList(pack.synonyms)) {
    next.synonyms = pack.synonyms
    changed = true
  }
  if (isEmptyList(next.antonyms) && !isEmptyList(pack.antonyms)) {
    next.antonyms = pack.antonyms
    changed = true
  }
  if (isEmptyList(next.usagePrompts) && !isEmptyList(pack.usagePrompts)) {
    next.usagePrompts = pack.usagePrompts
    changed = true
  }
  if (isEmptyList(next.acceptedZhAnswers) && !isEmptyList(pack.acceptedZhAnswers)) {
    next.acceptedZhAnswers = pack.acceptedZhAnswers
    changed = true
  }
  if (isEmptyList(next.acceptedEnVariants) && !isEmptyList(pack.acceptedEnVariants)) {
    next.acceptedEnVariants = pack.acceptedEnVariants
    changed = true
  }

  if (changed) {
    next.updatedAt = Date.parse(pack.updatedAt) > Date.parse(local.updatedAt)
      ? pack.updatedAt
      : local.updatedAt
  }

  return { word: next, changed }
}

export function validateVocabularyPack(value: unknown): asserts value is VocabularyPackV1 {
  const record = objectAt(value, '$', [
    'version',
    'kind',
    'exportedAt',
    'words',
    'lists',
    'memberships',
  ])
  if (record.version !== 1) fail('$.version', '仅支持版本 1')
  if (record.kind !== 'vocabulary-pack') {
    fail('$.kind', "必须是 'vocabulary-pack'")
  }
  dateAt(record.exportedAt, '$.exportedAt')
  arrayAt(record.words, '$.words', validateWord)
  arrayAt(record.lists, '$.lists', validateVocabularyList)
  arrayAt(record.memberships, '$.memberships', validateWordListItem)
}

function deduplicatePack(pack: VocabularyPackV1): VocabularyPackV1 {
  const words: Word[] = []
  const wordsByIdentity = new Map<string, { index: number; id: string }>()
  const wordIdentityById = new Map<string, string>()
  const itemIdMap = new Map<string, string>()

  for (const word of pack.words) {
    const identity = wordIdentity(word)
    const priorIdentity = wordIdentityById.get(word.id)
    if (priorIdentity && priorIdentity !== identity) {
      fail('$.words', `词条 ID ${word.id} 指向了不同义项`)
    }
    wordIdentityById.set(word.id, identity)

    const existing = wordsByIdentity.get(identity)
    if (!existing) {
      wordsByIdentity.set(identity, { index: words.length, id: word.id })
      itemIdMap.set(word.id, word.id)
      words.push(word)
      continue
    }

    itemIdMap.set(word.id, existing.id)
    const preferred = preferWord(words[existing.index], word)
    words[existing.index] = { ...preferred, id: existing.id }
  }

  const canonicalWordIds = new Set(words.map((word) => word.id))
  const knownListIds = new Set(ALL_VOCABULARY_LISTS.map((list) => list.id))
  for (const list of pack.lists) {
    const canonicalId = LIST_IDS[list.slug]
    knownListIds.add(canonicalId)
    knownListIds.add(list.id)
  }

  const memberships: WordListItem[] = []
  const membershipByKey = new Map<string, number>()
  for (const sourceMembership of pack.memberships) {
    const wordId = itemIdMap.get(sourceMembership.wordId) ?? sourceMembership.wordId
    if (!canonicalWordIds.has(wordId)) {
      fail('$.memberships', `列表关联 ${sourceMembership.id} 引用了不存在的词条`)
    }
    if (!knownListIds.has(sourceMembership.listId)) {
      fail('$.memberships', `列表关联 ${sourceMembership.id} 引用了不存在的词表`)
    }
    const listId = resolveListId(sourceMembership.listId, pack.lists)
    const membership = { ...sourceMembership, wordId, listId }
    const key = `${membership.wordId}\u0000${membership.listId}`
    const existingIndex = membershipByKey.get(key)
    if (existingIndex === undefined) {
      membershipByKey.set(key, memberships.length)
      memberships.push(membership)
      continue
    }
    memberships[existingIndex] = membership
  }

  return {
    ...pack,
    words,
    lists: ALL_VOCABULARY_LISTS,
    memberships,
  }
}

function resolveListId(listId: string, packLists: VocabularyList[]): string {
  const byCanonical = ALL_VOCABULARY_LISTS.find((list) => list.id === listId)
  if (byCanonical) return byCanonical.id

  const fromPack = packLists.find((list) => list.id === listId)
  if (fromPack) return LIST_IDS[fromPack.slug]

  return listId
}

function resolveListSlug(listId: string, packLists: VocabularyList[]) {
  const resolvedId = resolveListId(listId, packLists)
  const canonical = ALL_VOCABULARY_LISTS.find((list) => list.id === resolvedId)
  if (canonical) return canonical.slug
  return packLists.find((list) => list.id === listId || LIST_IDS[list.slug] === resolvedId)?.slug
}

export function parseVocabularyPack(input: unknown): VocabularyPackV1 {
  const decoded = stripImportMetadata(decodeInput(input))
  validateVocabularyPack(decoded)
  return deduplicatePack(decoded)
}

/** Design A: drop top-level pack `note` (and only that metadata) before strict schema checks. */
function stripImportMetadata(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  if (!('note' in value)) return value
  const { note: _note, ...rest } = value as Record<string, unknown>
  return rest
}

export async function exportVocabularyPack(now = new Date()): Promise<VocabularyPackV1> {
  const snapshot = await getUserDataSnapshot()
  return {
    version: 1,
    kind: 'vocabulary-pack',
    exportedAt: now.toISOString(),
    words: snapshot.words.map(({ knownAt: _knownAt, ...word }) => word),
    lists: snapshot.lists.length ? snapshot.lists : ALL_VOCABULARY_LISTS,
    memberships: snapshot.memberships,
  }
}

export async function exportVocabularyPackJson(space = 2): Promise<string> {
  return JSON.stringify(await exportVocabularyPack(), null, space)
}

function allocateWordId(
  preferredId: string,
  localIds: Set<string>,
  usedIds: Set<string>,
): string {
  if (!localIds.has(preferredId) && !usedIds.has(preferredId)) return preferredId
  let suffix = 1
  while (true) {
    const candidate = `${preferredId}-import-${suffix}`
    if (!localIds.has(candidate) && !usedIds.has(candidate)) return candidate
    suffix += 1
  }
}

export async function importVocabularyPack(
  input: unknown,
  now = new Date(),
): Promise<VocabularyPackImportSummary> {
  const pack = parseVocabularyPack(input)
  const snapshot = await getUserDataSnapshot()

  const localByIdentity = new Map(
    snapshot.words.map((word) => [wordIdentity(word), word] as const),
  )
  const localById = new Map(snapshot.words.map((word) => [word.id, word] as const))
  const localIds = new Set(snapshot.words.map((word) => word.id))
  const localMembershipKeys = new Set(
    snapshot.memberships.map((item) => `${item.wordId}\u0000${item.listId}`),
  )

  const wordsToWrite: Word[] = []
  const membershipsToWrite: WordListItem[] = []
  const newWordsForTracks: Word[] = []
  const usedNewIds = new Set<string>()

  let added = 0
  let updated = 0
  let unchanged = 0
  let membershipsAdded = 0

  const packWordIdToLocalId = new Map<string, string>()

  for (const packWord of pack.words) {
    const identity = wordIdentity(packWord)
    const sameId = localById.get(packWord.id)
    // A corrected expression still belongs to the original sense and its learning history.
    if (sameId && semanticPart(sameId.senseKey) === semanticPart(packWord.senseKey) && wordIdentity(sameId) !== identity) {
      packWordIdToLocalId.set(packWord.id, sameId.id)
      unchanged += 1
      continue
    }
    const localWord = localByIdentity.get(identity)

    if (!localWord) {
      const id = allocateWordId(packWord.id, localIds, usedNewIds)
      usedNewIds.add(id)
      const { knownAt: _knownAt, ...lexicalWord } = packWord
      const word = { ...lexicalWord, id }
      wordsToWrite.push(word)
      newWordsForTracks.push(word)
      packWordIdToLocalId.set(packWord.id, id)
      localIds.add(id)
      localByIdentity.set(identity, word)
      added += 1
      continue
    }

    packWordIdToLocalId.set(packWord.id, localWord.id)
    const { word: merged, changed } = enrichLocalWordFromPack(
      localWord,
      { ...packWord, id: localWord.id },
    )
    if (changed) {
      wordsToWrite.push(merged)
      localByIdentity.set(identity, merged)
      updated += 1
    } else {
      unchanged += 1
    }
  }

  for (const sourceMembership of pack.memberships) {
    const localWordId = packWordIdToLocalId.get(sourceMembership.wordId)
    if (!localWordId) continue
    const listId = resolveListId(sourceMembership.listId, pack.lists)
    const listSlug = resolveListSlug(sourceMembership.listId, pack.lists)
    const key = `${localWordId}\u0000${listId}`
    if (localMembershipKeys.has(key)) continue

    const membership: WordListItem = {
      ...sourceMembership,
      id: `membership-${localWordId}-${listSlug ?? listId}`,
      wordId: localWordId,
      listId,
    }
    membershipsToWrite.push(membership)
    localMembershipKeys.add(key)
    membershipsAdded += 1
  }

  const tracks: LearningTrack[] = createInitialTracks(newWordsForTracks, now)

  if (wordsToWrite.length || membershipsToWrite.length || tracks.length) {
    await writeBatch({
      words: wordsToWrite,
      memberships: membershipsToWrite,
      tracks,
    })
  }

  return { added, updated, unchanged, membershipsAdded }
}
