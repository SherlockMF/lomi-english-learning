import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from 'idb'

import { ALL_VOCABULARY_LISTS, listIdForSlug } from '../data/vocabularyLists'
import { SEED_CONTENT_REVISION } from '../data/seedContentRevision'
import { isVocabularyLevel } from './studyDifficulty'
import { trackDatabase } from './cloud/tracking'
import type { CloudMeta, QueueEntry } from './cloud/types'
import type { VoiceHistoryRecord } from './voice/history'
import { sameCloudData } from './cloud/merge'
import {
  createInitialTracks,
  scheduleReview,
  unlockEligibleUsageTracks,
} from './scheduler'
import {
  DEFAULT_SETTINGS,
  hydrateWord,
  normalizeLemma,
  primaryListSlug,
  type DictionaryCache,
  type DictionaryResult,
  type LearningTrack,
  type ListSlug,
  type ReviewAttempt,
  type ReviewRating,
  type SpeechAccent,
  type StudyTimeEntry,
  type SystemListSlug,
  type TrackType,
  type UserSettings,
  type VocabularyItem,
  type VocabularyList,
  type VocabularyStatus,
  type Word,
  type WordListItem,
} from '../domain/types'

export const DATABASE_NAME = 'recall-english'
export const DATABASE_VERSION = 5

export interface RecallEnglishDatabase extends DBSchema {
  voiceHistory: { key: string; value: VoiceHistoryRecord | { id: string; deleted: true }; indexes: { 'by-created-at': string } }
  cloudQueue: { key: string; value: QueueEntry }
  cloudMeta: { key: string; value: CloudMeta }
  words: {
    key: string
    value: Word
    indexes: {
      'by-expression': string
      'by-lemma': string
      'by-status': VocabularyStatus
    }
  }
  vocabularyLists: {
    key: string
    value: VocabularyList
    indexes: {
      'by-slug': string
    }
  }
  wordListItems: {
    key: string
    value: WordListItem
    indexes: {
      'by-word': string
      'by-list': string
    }
  }
  tracks: {
    key: string
    value: LearningTrack
    indexes: {
      'by-item': string
      'by-due': string
      'by-type': TrackType
    }
  }
  attempts: {
    key: string
    value: ReviewAttempt
    indexes: {
      'by-item': string
      'by-track': string
      'by-reviewed-at': string
    }
  }
  settings: {
    key: UserSettings['id']
    value: UserSettings
  }
  timeEntries: {
    key: string
    value: StudyTimeEntry
    indexes: {
      'by-session-date': [string, string]
    }
  }
  dictionaryCache: {
    key: string
    value: DictionaryCache
    indexes: {
      'by-cached-at': string
    }
  }
}

export interface DatabaseBatch {
  expectedWords?: Word[]
  words?: Word[]
  lists?: VocabularyList[]
  memberships?: WordListItem[]
  deleteMembershipIds?: string[]
  tracks?: LearningTrack[]
  attempts?: ReviewAttempt[]
  timeEntries?: StudyTimeEntry[]
  settings?: UserSettings
  dictionaryCache?: DictionaryCache[]
}

export interface UserDataSnapshot {
  words: Word[]
  lists: VocabularyList[]
  memberships: WordListItem[]
  vocabulary: VocabularyItem[]
  tracks: LearningTrack[]
  attempts: ReviewAttempt[]
  timeEntries: StudyTimeEntry[]
  settings: UserSettings
}

let databasePromise: Promise<IDBPDatabase<RecallEnglishDatabase>> | undefined
let databaseAccount: string | null = null
let trackingEnabled = false
let rawDatabasePromise: Promise<IDBPDatabase<RecallEnglishDatabase>> | undefined

export function setDatabaseTrackingEnabled(enabled: boolean) { trackingEnabled = enabled }
export function getDatabaseAccount() { return databaseAccount }

export async function selectDatabaseAccount(account: string | null) {
  if (account !== null && !/^[a-z\d-]{1,80}$/i.test(account)) throw new Error('账号标识无效。')
  trackingEnabled = false
  if (databaseAccount === account) return
  await closeDatabase()
  databaseAccount = account
}

export async function getRawDatabase() {
  await getDatabase()
  return rawDatabasePromise!
}

function createDefaultSettings(): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    contentMix: { ...DEFAULT_SETTINGS.contentMix },
  }
}

function normalizeSpeechAccent(value: unknown): SpeechAccent {
  return value === 'us' ? 'us' : 'uk'
}

export function normalizeUserSettings(raw: Partial<UserSettings> | UserSettings): UserSettings {
  return {
    ...createDefaultSettings(),
    ...raw,
    id: 'primary',
    dailyMinutes: boundedInteger(raw.dailyMinutes ?? raw.coreMinutes, 5, 120, DEFAULT_SETTINGS.dailyMinutes),
    newItemsPerDay: boundedInteger(raw.newItemsPerDay, 0, 100, DEFAULT_SETTINGS.newItemsPerDay),
    contentMix: normalizeContentMix(raw.contentMix),
    speechAccent: normalizeSpeechAccent(raw.speechAccent),
    vocabularyLevel: isVocabularyLevel(raw.vocabularyLevel) ? raw.vocabularyLevel : 'B1',
    adaptiveDifficulty: typeof raw.adaptiveDifficulty === 'boolean' ? raw.adaptiveDifficulty : true,
    difficultyResetAt: typeof raw.difficultyResetAt === 'string' && Number.isFinite(Date.parse(raw.difficultyResetAt)) ? raw.difficultyResetAt : undefined,
    onboardingCompletedAt: typeof raw.onboardingCompletedAt === 'string' && Number.isFinite(Date.parse(raw.onboardingCompletedAt)) ? raw.onboardingCompletedAt : undefined,
    learningGoal: raw.learningGoal && ['daily', 'business', 'finance', 'accounting'].includes(raw.learningGoal) ? raw.learningGoal : undefined,
    seedContentRevision:
      typeof raw.seedContentRevision === 'string' && raw.seedContentRevision.trim()
        ? raw.seedContentRevision.trim()
        : undefined,
    dictionaryContentRevision:
      typeof raw.dictionaryContentRevision === 'string' && raw.dictionaryContentRevision.trim()
        ? raw.dictionaryContentRevision.trim()
        : undefined,
  }
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

export function normalizeDictionaryQuery(query: string): string {
  return query.trim().toLocaleLowerCase('en-US')
}

function normalizeContentMix(raw: Record<string, number> | undefined): Record<SystemListSlug, number> {
  const defaults = DEFAULT_SETTINGS.contentMix
  if (!raw) return { ...defaults }
  const daily = Number(raw.daily)
  const business = Number(raw.business)
  const finance = Number(raw.finance)
  const accounting = Number(raw.accounting)
  const legacyFinanceMix = !Number.isFinite(accounting) && Number.isFinite(finance)
  return {
    daily: Number.isFinite(daily) ? daily : defaults.daily,
    business: Number.isFinite(business) ? business : defaults.business,
    finance: legacyFinanceMix ? finance * 0.5 : Number.isFinite(finance) ? finance : defaults.finance,
    accounting: legacyFinanceMix ? finance * 0.5 : Number.isFinite(accounting) ? accounting : defaults.accounting,
  }
}

function migrateLegacyVocabularyRecord(raw: Record<string, unknown>): Word {
  const expression = String(raw.expression ?? '')
  return {
    id: String(raw.id),
    expression,
    lemma: typeof raw.lemma === 'string' && raw.lemma ? raw.lemma : normalizeLemma(expression),
    senseKey: String(raw.senseKey ?? ''),
    zhGloss: String(raw.zhGloss ?? ''),
    enDefinition: String(raw.enDefinition ?? ''),
    partOfSpeech: String(raw.partOfSpeech ?? 'expression'),
    acceptedZhAnswers: Array.isArray(raw.acceptedZhAnswers)
      ? raw.acceptedZhAnswers.map(String)
      : [],
    acceptedEnVariants: Array.isArray(raw.acceptedEnVariants)
      ? raw.acceptedEnVariants.map(String)
      : [],
    examples: Array.isArray(raw.examples)
      ? (raw.examples as Word['examples'])
      : [],
    collocations: Array.isArray(raw.collocations) ? raw.collocations.map(String) : [],
    source: raw.source === 'custom' || raw.source === 'dictionary' ? raw.source : 'seed',
    priority: Number(raw.priority) || 1,
    status: raw.status === 'paused' ? 'paused' : 'active',
    ipaUk: typeof raw.ipaUk === 'string' ? raw.ipaUk : undefined,
    ipaUs: typeof raw.ipaUs === 'string' ? raw.ipaUs : undefined,
    audioUk: typeof raw.audioUk === 'string' ? raw.audioUk : undefined,
    audioUs: typeof raw.audioUs === 'string' ? raw.audioUs : undefined,
    synonyms: Array.isArray(raw.synonyms) ? raw.synonyms.map(String) : undefined,
    antonyms: Array.isArray(raw.antonyms) ? raw.antonyms.map(String) : undefined,
    usagePrompts: Array.isArray(raw.usagePrompts)
      ? (raw.usagePrompts as Word['usagePrompts'])
      : [],
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  }
}

function legacyCategoryToSlugs(category: unknown, expression: string): ListSlug[] {
  if (category === 'daily') return ['daily']
  if (category === 'business') return ['business']
  if (category === 'custom' || category === 'my-vocabulary') return ['my-vocabulary']
  if (category === 'accounting') return ['accounting']
  if (category === 'finance') {
    // Deferred import avoided — duplicate minimal split for upgrade path
    const key = expression.trim().toLocaleLowerCase('en-US')
    const accountingOnly = new Set([
      'asset', 'liability', 'revenue', 'expense', 'profit', 'loss',
      'accounts receivable', 'accounts payable', 'inventory', 'depreciation',
      'amortisation', 'accrual', 'prepayment', 'provision', 'impairment',
      'carrying amount', 'fair value', 'historical cost', 'materiality',
      'going concern', 'double-entry bookkeeping', 'debit', 'credit',
      'journal entry', 'general ledger', 'trial balance', 'financial statements',
      'statement of financial position', 'income statement', 'statement of cash flows',
      'retained earnings', 'share capital', 'cost of sales', 'gross profit',
      'operating profit', 'net profit', 'current ratio', 'interest expense',
      'budget', 'forecast', 'variance', 'break-even point', 'fixed cost',
      'variable cost', 'contribution margin', 'overhead', 'audit', 'auditor',
      'audit evidence', 'internal control', 'reconciliation', 'tax liability',
      'deferred tax', 'IFRS', 'recognition', 'measurement', 'disclosure',
    ])
    const both = new Set([
      'equity', 'cash flow', 'dividend', 'working capital', 'liquidity', 'solvency', 'leverage',
    ])
    if (both.has(key)) return ['finance', 'accounting']
    if (accountingOnly.has(key)) return ['accounting']
    return ['finance']
  }
  return ['my-vocabulary']
}

async function migrateV1ToV2(
  database: IDBPDatabase<RecallEnglishDatabase>,
  transaction: IDBPTransaction<
    RecallEnglishDatabase,
    ('words' | 'vocabularyLists' | 'wordListItems' | 'settings')[],
    'versionchange'
  >,
): Promise<void> {
  // Legacy v1 store is outside the typed v2 schema.
  const untypedDb = database as unknown as {
    objectStoreNames: DOMStringList
    deleteObjectStore: (name: string) => void
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyTx = transaction as any
  if (!legacyTx.objectStoreNames.contains('vocabulary')) return

  const vocabularyStore = legacyTx.objectStore('vocabulary')
  const legacyItems: Record<string, unknown>[] = await vocabularyStore.getAll()
  const wordStore = transaction.objectStore('words')
  const membershipStore = transaction.objectStore('wordListItems')
  const listStore = transaction.objectStore('vocabularyLists')

  for (const list of ALL_VOCABULARY_LISTS) {
    await listStore.put(list)
  }

  for (const raw of legacyItems) {
    const word = migrateLegacyVocabularyRecord(raw)
    await wordStore.put(word)
    const slugs = legacyCategoryToSlugs(raw.category, word.expression)
    for (const [index, slug] of slugs.entries()) {
      await membershipStore.put({
        id: `membership-${word.id}-${slug}`,
        wordId: word.id,
        listId: listIdForSlug(slug),
        priority: word.priority,
        sortOrder: index,
      })
    }
  }

  if (legacyTx.objectStoreNames.contains('settings')) {
    const settingsStore = legacyTx.objectStore('settings')
    const settings = await settingsStore.get('primary')
    if (settings) {
      await transaction.objectStore('settings').put({
        ...settings,
        contentMix: normalizeContentMix(settings.contentMix),
      })
    }
  }

  untypedDb.deleteObjectStore('vocabulary')
}

function createStores(
  database: IDBPDatabase<RecallEnglishDatabase>,
  oldVersion: number,
): void {
  if (!database.objectStoreNames.contains('voiceHistory')) {
    const store = database.createObjectStore('voiceHistory', { keyPath: 'id' })
    store.createIndex('by-created-at', 'createdAt')
  }
  if (oldVersion < 1) {
    // Fresh installs historically created these in v1; keep for completeness when jumping to v2.
  }

  if (!database.objectStoreNames.contains('tracks')) {
    const store = database.createObjectStore('tracks', { keyPath: 'id' })
    store.createIndex('by-item', 'itemId')
    store.createIndex('by-due', 'due')
    store.createIndex('by-type', 'type')
  }

  if (!database.objectStoreNames.contains('attempts')) {
    const store = database.createObjectStore('attempts', { keyPath: 'id' })
    store.createIndex('by-item', 'itemId')
    store.createIndex('by-track', 'trackId')
    store.createIndex('by-reviewed-at', 'reviewedAt')
  }

  if (!database.objectStoreNames.contains('settings')) {
    database.createObjectStore('settings', { keyPath: 'id' })
  }

  if (!database.objectStoreNames.contains('timeEntries')) {
    const store = database.createObjectStore('timeEntries', { keyPath: 'id' })
    store.createIndex('by-session-date', ['sessionId', 'localDate'], { unique: true })
  }

  if (!database.objectStoreNames.contains('dictionaryCache')) {
    const store = database.createObjectStore('dictionaryCache', { keyPath: 'query' })
    store.createIndex('by-cached-at', 'cachedAt')
  }

  if (!database.objectStoreNames.contains('words')) {
    const store = database.createObjectStore('words', { keyPath: 'id' })
    store.createIndex('by-expression', 'expression')
    store.createIndex('by-lemma', 'lemma')
    store.createIndex('by-status', 'status')
  }

  if (!database.objectStoreNames.contains('vocabularyLists')) {
    const store = database.createObjectStore('vocabularyLists', { keyPath: 'id' })
    store.createIndex('by-slug', 'slug')
  }

  if (!database.objectStoreNames.contains('wordListItems')) {
    const store = database.createObjectStore('wordListItems', { keyPath: 'id' })
    store.createIndex('by-word', 'wordId')
    store.createIndex('by-list', 'listId')
  }
}

export function getDatabase(): Promise<IDBPDatabase<RecallEnglishDatabase>> {
  if (!databasePromise) {
    const account = databaseAccount
    rawDatabasePromise = openDB<RecallEnglishDatabase>(account ? `${DATABASE_NAME}:${account}` : DATABASE_NAME, DATABASE_VERSION, {
      async upgrade(database, oldVersion, _newVersion, transaction) {
        if (!database.objectStoreNames.contains('cloudQueue')) database.createObjectStore('cloudQueue', { keyPath: 'id' })
        if (!database.objectStoreNames.contains('cloudMeta')) database.createObjectStore('cloudMeta', { keyPath: 'key' })
        if (oldVersion < 1) {
          // Create legacy vocabulary only if we somehow open empty DB as v1 path — skip, go straight to v2 stores.
        }

        if (oldVersion === 1 && !database.objectStoreNames.contains('words')) {
          // Ensure v1 stores exist before migration helpers run (already present on real v1 DBs).
        }

        if (oldVersion < 1) {
          createStores(database, oldVersion)
          // Brand-new: also create temporary empty path — words already created.
        } else if (oldVersion < 2) {
          createStores(database, oldVersion)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await migrateV1ToV2(database, transaction as any)
        } else {
          createStores(database, oldVersion)
        }
        const settingsStore = transaction.objectStore('settings')
        const settings = await settingsStore.get('primary')
        if (settings) await settingsStore.put(normalizeUserSettings(settings))
      },
    })
    databasePromise = rawDatabasePromise.then(database => account ? trackDatabase(database, () => trackingEnabled) : database)
    databasePromise.catch(() => {
      databasePromise = undefined
      rawDatabasePromise = undefined
    })
  }

  return databasePromise
}

export interface InitializeDatabaseResult {
  /** True when this call wrote the initial empty-library seed tracks. */
  seeded: boolean
  /** True when an existing library needed no word/membership/track writes. */
  skipped: boolean
}

export interface LibrarySeedStatus {
  /** True when the bundled seed pack must be loaded before initializing. */
  needsBundledSeed: boolean
}

/**
 * Cheap read-only probe so callers can skip loading the bundled seed pack
 * when a healthy library already matches the current seed revision. Seed
 * writes and the revision stamp commit in one transaction, so a matching
 * stamp guarantees the bundled seed has already been applied.
 *
 * Invariant: every code path that removes seed words (or restores a backup
 * whose revision equals the current one while carrying fewer words) must
 * invalidate the stored seedContentRevision, otherwise missing bundled
 * words would never be re-seeded. There is currently no delete-word path.
 */
export async function getLibrarySeedStatus(
  settings: UserSettings = createDefaultSettings(),
): Promise<LibrarySeedStatus> {
  const database = await getDatabase()
  const transaction = database.transaction(['words', 'settings'], 'readonly')
  const wordCount = await transaction.objectStore('words').count()
  const stored = await transaction.objectStore('settings').get('primary')
  const targetRevision = settings.seedContentRevision ?? SEED_CONTENT_REVISION
  const isEmptyLibrary = wordCount === 0
  const revisionChanged =
    !isEmptyLibrary && (stored?.seedContentRevision ?? '') !== targetRevision
  return { needsBundledSeed: isEmptyLibrary || revisionChanged }
}

export async function initializeDatabase(
  seedWords: Word[] = [],
  seedMemberships: WordListItem[] = [],
  seedTracks?: LearningTrack[],
  settings: UserSettings = createDefaultSettings(),
  seedLists: VocabularyList[] = ALL_VOCABULARY_LISTS,
): Promise<InitializeDatabaseResult> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['words', 'vocabularyLists', 'wordListItems', 'tracks', 'settings', 'cloudMeta'],
    'readwrite',
  )
  const wordStore = transaction.objectStore('words')
  const listStore = transaction.objectStore('vocabularyLists')
  const membershipStore = transaction.objectStore('wordListItems')
  const trackStore = transaction.objectStore('tracks')
  const settingsStore = transaction.objectStore('settings')

  if (databaseAccount && seedWords.length) {
    const meta = transaction.objectStore('cloudMeta')
    const existing = await meta.get('sharedSeedIds')
    const ids = new Set((existing?.value ?? []) as string[])
    for (const word of seedWords) ids.add(word.id)
    await meta.put({ key: 'sharedSeedIds', value: [...ids] })
  }

  for (const list of seedLists) {
    if (!(await listStore.get(list.id))) {
      await listStore.put(list)
    }
  }

  const existingSettings = await settingsStore.get('primary')
  const targetRevision = settings.seedContentRevision ?? SEED_CONTENT_REVISION
  const wordCount = await wordStore.count()
  const isEmptyLibrary = wordCount === 0
  const shouldRefreshSeedContent =
    !isEmptyLibrary &&
    (existingSettings?.seedContentRevision ?? '') !== targetRevision &&
    seedWords.length > 0

  let existingIds = new Set<string>()
  let existingIdentities = new Set<string>()
  let existingWords: Word[] = []

  if (isEmptyLibrary || shouldRefreshSeedContent) {
    existingWords = await wordStore.getAll()
    existingIds = new Set(existingWords.map((word) => word.id))
    existingIdentities = new Set(existingWords.map((word) => lexicalIdentity(word)))
  } else {
    existingIds = new Set((await wordStore.getAllKeys()) as string[])
  }

  if (shouldRefreshSeedContent) {
    const seedById = new Map(seedWords.map((word) => [word.id, word]))
    for (const local of existingWords) {
      const seed = seedById.get(local.id)
      if (!seed) continue
      if (local.source !== 'seed') continue
      // Legacy records do not distinguish content edits from other personal actions.
      const contentEdited = local.contentEdited ?? local.updatedAt !== local.createdAt
      if (contentEdited) {
        if (local.contentEdited === undefined) wordStore.put({ ...local, contentEdited: true })
        continue
      }
      wordStore.put({
        ...seed,
        createdAt: local.createdAt || seed.createdAt,
        contentEdited: false,
        status: local.status,
        priority: local.priority,
        knownAt: local.knownAt,
        vocabularyLevel: local.vocabularyLevel,
      })
    }
  }

  const candidateWords = seedWords.filter((word) => !existingIds.has(word.id))
  if (candidateWords.length > 0 && existingIdentities.size === 0 && !isEmptyLibrary) {
    // Cheap path: only load identities when new seed ids appear.
    existingWords = await wordStore.getAll()
    existingIdentities = new Set(existingWords.map((word) => lexicalIdentity(word)))
  }

  const wordsToAdd = candidateWords.filter((word) => (
    !existingIdentities.has(lexicalIdentity(word))
  ))
  // Issue all puts without awaiting: requests queue inside the open
  // transaction, which is far faster than serializing on each request.
  for (const word of wordsToAdd) {
    wordStore.put(word)
    existingIds.add(word.id)
  }

  const existingMembershipKeys = new Set(
    ((await membershipStore.getAllKeys()) as string[]),
  )
  const membershipKeys = new Set(existingMembershipKeys)
  // Legacy installs may use non-canonical membership ids; keep pair de-dupe.
  let membershipPairs: Set<string> | undefined
  const membershipsToAdd: WordListItem[] = []
  for (const membership of seedMemberships) {
    if (!existingIds.has(membership.wordId)) continue
    if (membershipKeys.has(membership.id)) continue
    if (!membershipPairs) {
      const existingMemberships = await membershipStore.getAll()
      membershipPairs = new Set(
        existingMemberships.map((item) => `${item.wordId}\u0000${item.listId}`),
      )
    }
    const key = `${membership.wordId}\u0000${membership.listId}`
    if (membershipPairs.has(key)) continue
    membershipsToAdd.push(membership)
    membershipKeys.add(membership.id)
    membershipPairs.add(key)
  }
  for (const membership of membershipsToAdd) {
    membershipStore.put(membership)
  }

  let seeded = false
  if (isEmptyLibrary) {
    const tracksToWrite = seedTracks ?? createInitialTracks(seedWords)
    for (const track of tracksToWrite) {
      trackStore.put(track)
    }
    seeded = true
  } else if (wordsToAdd.length > 0) {
    for (const track of createInitialTracks(wordsToAdd)) {
      trackStore.put(track)
    }
  }

  if (!existingSettings) {
    await settingsStore.put({
      ...normalizeUserSettings(settings),
      seedContentRevision: targetRevision,
    })
  } else {
    await settingsStore.put({
      ...normalizeUserSettings(existingSettings),
      seedContentRevision: targetRevision,
    })
  }

  await transaction.done

  const skipped = !isEmptyLibrary
    && !shouldRefreshSeedContent
    && wordsToAdd.length === 0
    && membershipsToAdd.length === 0

  return { seeded, skipped }
}

function lexicalIdentity(word: Pick<Word, 'expression' | 'senseKey'>): string {
  return `${semanticPart(word.expression)}\u0000${semanticPart(word.senseKey)}`
}

function semanticPart(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
}

function slugByListId(lists: VocabularyList[]): Map<string, ListSlug> {
  return new Map(lists.map((list) => [list.id, list.slug]))
}

export function hydrateWords(
  words: Word[],
  memberships: WordListItem[],
  lists: VocabularyList[],
): VocabularyItem[] {
  const listMap = slugByListId(lists)
  const byWord = new Map<string, ListSlug[]>()
  const noteByWord = new Map<string, string>()
  for (const membership of memberships) {
    const slug = listMap.get(membership.listId)
    if (!slug) continue
    const current = byWord.get(membership.wordId) ?? []
    if (!current.includes(slug)) current.push(slug)
    byWord.set(membership.wordId, current)
    const note = membership.subcategory?.trim()
    if (note && !noteByWord.has(membership.wordId)) {
      noteByWord.set(membership.wordId, note)
    }
  }
  return words.map((word) => hydrateWord(word, byWord.get(word.id) ?? [], noteByWord.get(word.id)))
}

export async function getWord(id: string): Promise<Word | undefined> {
  return (await getDatabase()).get('words', id)
}

export async function getAllWords(): Promise<Word[]> {
  return (await getDatabase()).getAll('words')
}

export async function getWordsByStatus(status: VocabularyStatus): Promise<Word[]> {
  return (await getDatabase()).getAllFromIndex('words', 'by-status', status)
}

export async function putWord(word: Word): Promise<void> {
  await (await getDatabase()).put('words', word)
}

export async function patchWord(id: string, patch: Partial<Word> | ((current: Word) => Partial<Word>)): Promise<Word> {
  const tx = (await getDatabase()).transaction('words', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error('词条不存在，请刷新词库。')
  const changes = typeof patch === 'function' ? patch(current) : patch
  const updated = { ...current, ...changes, id: current.id, contentEdited: changes.contentEdited ?? current.contentEdited ?? current.updatedAt !== current.createdAt, updatedAt: new Date().toISOString() }
  await tx.store.put(updated)
  await tx.done
  return updated
}

export async function putWords(words: Word[]): Promise<void> {
  await writeBatch({ words })
}

export async function getAllVocabularyLists(): Promise<VocabularyList[]> {
  return (await getDatabase()).getAll('vocabularyLists')
}

export async function putVocabularyList(list: VocabularyList): Promise<void> {
  await (await getDatabase()).put('vocabularyLists', list)
}

export async function getAllWordListItems(): Promise<WordListItem[]> {
  return (await getDatabase()).getAll('wordListItems')
}

export async function getWordListItemsForWord(wordId: string): Promise<WordListItem[]> {
  return (await getDatabase()).getAllFromIndex('wordListItems', 'by-word', wordId)
}

export async function getWordListItemsForList(listId: string): Promise<WordListItem[]> {
  return (await getDatabase()).getAllFromIndex('wordListItems', 'by-list', listId)
}

export async function putWordListItem(item: WordListItem): Promise<void> {
  await (await getDatabase()).put('wordListItems', item)
}

export async function isWordInList(wordId: string, listId: string): Promise<boolean> {
  const items = await getWordListItemsForWord(wordId)
  return items.some((item) => item.listId === listId)
}

export async function addWordToList(
  wordId: string,
  listSlug: ListSlug,
  priority = 1,
): Promise<WordListItem> {
  const listId = listIdForSlug(listSlug)
  const existing = await getWordListItemsForWord(wordId)
  const found = existing.find((item) => item.listId === listId)
  if (found) return found
  const membership: WordListItem = {
    id: `membership-${wordId}-${listSlug}`,
    wordId,
    listId,
    priority,
    sortOrder: existing.length,
  }
  await putWordListItem(membership)
  return membership
}

/** Removes only the membership, retaining the word and its learning history. */
export async function removeWordFromList(wordId: string, listSlug: ListSlug): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction('wordListItems', 'readwrite')
  const store = transaction.objectStore('wordListItems')
  const memberships = await store.index('by-word').getAll(wordId)
  const listId = listIdForSlug(listSlug)
  await Promise.all(memberships.filter((membership) => membership.listId === listId)
    .map((membership) => store.delete(membership.id)))
  await transaction.done
}

/** Snapshot of every hydrated vocabulary item (words + memberships + lists). */
export async function getAllVocabulary(): Promise<VocabularyItem[]> {
  return (await getUserDataSnapshot()).vocabulary
}

export async function putVocabularyItems(items: Array<VocabularyItem | Word>): Promise<void> {
  await writeBatch({
    words: items.map((item) => {
      const { listSlugs: _a, category: _b, ...word } = item as VocabularyItem
      return word
    }),
  })
}

export async function deleteVocabularyItem(id: string): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['words', 'wordListItems', 'tracks', 'attempts'],
    'readwrite',
  )
  const trackStore = transaction.objectStore('tracks')
  const attemptStore = transaction.objectStore('attempts')
  const membershipStore = transaction.objectStore('wordListItems')
  const [trackIds, attemptIds, membershipIds] = await Promise.all([
    trackStore.index('by-item').getAllKeys(id),
    attemptStore.index('by-item').getAllKeys(id),
    membershipStore.index('by-word').getAllKeys(id),
  ])
  await Promise.all([
    transaction.objectStore('words').delete(id),
    ...trackIds.map((trackId) => trackStore.delete(trackId)),
    ...attemptIds.map((attemptId) => attemptStore.delete(attemptId)),
    ...membershipIds.map((membershipId) => membershipStore.delete(membershipId)),
  ])
  await transaction.done
}

export async function getLearningTrack(id: string): Promise<LearningTrack | undefined> {
  return (await getDatabase()).get('tracks', id)
}

export async function getAllLearningTracks(): Promise<LearningTrack[]> {
  return (await getDatabase()).getAll('tracks')
}

export async function getLearningTracksForItem(itemId: string): Promise<LearningTrack[]> {
  return (await getDatabase()).getAllFromIndex('tracks', 'by-item', itemId)
}

export async function getDueLearningTracks(dueBefore: string): Promise<LearningTrack[]> {
  return (await getDatabase()).getAllFromIndex(
    'tracks',
    'by-due',
    IDBKeyRange.upperBound(dueBefore),
  )
}

export async function putLearningTrack(track: LearningTrack): Promise<void> {
  await (await getDatabase()).put('tracks', track)
}

export async function putLearningTracks(tracks: LearningTrack[]): Promise<void> {
  await writeBatch({ tracks })
}

export interface RecordReviewInput {
  trackId: string
  rating: ReviewRating
  desiredRetention: number
  attempt: Omit<ReviewAttempt, 'reviewedAt' | 'trackId' | 'rating'> & {
    trackId?: string
    rating?: ReviewRating
    reviewedAt?: string
  }
  reviewedAt?: Date
}

export interface RecordReviewResult {
  tracks: LearningTrack[]
  changedTracks: LearningTrack[]
  attempt: ReviewAttempt
  reviewedAt: Date
}

/**
 * Reads only this item's tracks inside one IndexedDB transaction, applies FSRS + usage lock sync,
 * then writes the attempt. Avoids full-table scans on large libraries and cross-tab last-write-wins
 * from stale React state.
 *
 * `tracks` is the updated sibling set for this item only; callers should merge `changedTracks`
 * into app state instead of replacing the full track list.
 */
export async function recordReview(input: RecordReviewInput): Promise<RecordReviewResult> {
  const database = await getDatabase()
  const transaction = database.transaction(['tracks', 'attempts'], 'readwrite')
  const trackStore = transaction.objectStore('tracks')
  const existingAttempt = await transaction.objectStore('attempts').get(input.attempt.id)
  if (existingAttempt) {
    const tracks = await trackStore.index('by-item').getAll(existingAttempt.itemId)
    await transaction.done
    return {
      tracks,
      changedTracks: [],
      attempt: existingAttempt,
      reviewedAt: new Date(existingAttempt.reviewedAt),
    }
  }
  const currentTrack = await trackStore.get(input.trackId)
  if (!currentTrack) {
    throw new Error('找不到当前学习轨道。')
  }

  const existingTracks = await trackStore.index('by-item').getAll(currentTrack.itemId)
  const reviewedAt = input.reviewedAt ?? new Date(input.attempt.reviewedAt ?? Date.now())
  const scheduledTrack = scheduleReview(
    currentTrack,
    input.rating,
    reviewedAt,
    input.desiredRetention,
  )
  const replacedTracks = existingTracks.map((track) => (
    track.id === scheduledTrack.id ? scheduledTrack : track
  ))
  const attempt: ReviewAttempt = {
    ...input.attempt,
    id: input.attempt.id,
    trackId: input.trackId,
    rating: input.rating,
    reviewedAt: reviewedAt.toISOString(),
    desiredRetention: input.desiredRetention,
    trackBefore: currentTrack,
  }
  const itemAttempts = await transaction.objectStore('attempts').index('by-item').getAll(currentTrack.itemId)
  const nextTracks = unlockEligibleUsageTracks(replacedTracks, reviewedAt, [...itemAttempts, attempt])
  const previousById = new Map(existingTracks.map((track) => [track.id, track]))
  // Always persist the reviewed track; also persist siblings whose unlock/due/good markers changed.
  const changedTracks = nextTracks.filter((track) => {
    if (track.id === scheduledTrack.id) return true
    const previous = previousById.get(track.id)
    if (!previous) return true
    return track.unlocked !== previous.unlocked
      || track.due !== previous.due
      || track.firstGoodAt !== previous.firstGoodAt
      || track.lastGoodAt !== previous.lastGoodAt
  })

  for (const track of changedTracks) {
    await trackStore.put(track)
  }
  await transaction.objectStore('attempts').put(attempt)
  await transaction.done

  return { tracks: nextTracks, changedTracks, attempt, reviewedAt }
}

export async function deleteLearningTrack(id: string): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(['tracks', 'attempts'], 'readwrite')
  const attemptStore = transaction.objectStore('attempts')
  const attemptIds = await attemptStore.index('by-track').getAllKeys(id)
  await Promise.all([
    transaction.objectStore('tracks').delete(id),
    ...attemptIds.map((attemptId) => attemptStore.delete(attemptId)),
  ])
  await transaction.done
}

export async function getReviewAttempt(id: string): Promise<ReviewAttempt | undefined> {
  return (await getDatabase()).get('attempts', id)
}

export async function getAllReviewAttempts(): Promise<ReviewAttempt[]> {
  return (await getDatabase()).getAll('attempts')
}

export async function getReviewAttemptsForItem(itemId: string): Promise<ReviewAttempt[]> {
  return (await getDatabase()).getAllFromIndex('attempts', 'by-item', itemId)
}

export async function putReviewAttempt(attempt: ReviewAttempt): Promise<void> {
  await (await getDatabase()).put('attempts', attempt)
}

export async function putReviewAttempts(attempts: ReviewAttempt[]): Promise<void> {
  await writeBatch({ attempts })
}

export async function deleteReviewAttempt(id: string): Promise<void> {
  await (await getDatabase()).delete('attempts', id)
}

export async function getAllStudyTimeEntries(): Promise<StudyTimeEntry[]> {
  return (await getDatabase()).getAll('timeEntries')
}

export async function putStudyTimeEntry(entry: StudyTimeEntry): Promise<StudyTimeEntry> {
  const database = await getDatabase()
  const transaction = database.transaction('timeEntries', 'readwrite')
  const existing = await transaction.store.index('by-session-date').get([entry.sessionId, entry.localDate])
  // Checkpoints contain cumulative time; a delayed checkpoint must never add or remove time.
  const saved = existing && existing.activeMs >= entry.activeMs
    ? existing
    : { ...entry, id: existing?.id ?? entry.id }
  await transaction.store.put(saved)
  await transaction.done
  return saved
}

export async function getSettings(): Promise<UserSettings> {
  const stored = await (await getDatabase()).get('settings', 'primary')
  if (!stored) return createDefaultSettings()
  return normalizeUserSettings(stored)
}

export async function putSettings(settings: UserSettings): Promise<void> {
  await (await getDatabase()).put('settings', normalizeUserSettings(settings))
}

export async function getDictionaryCache(
  query: string,
): Promise<DictionaryCache | undefined> {
  const normalizedQuery = normalizeDictionaryQuery(query)
  if (!normalizedQuery) return undefined
  return (await getDatabase()).get('dictionaryCache', normalizedQuery)
}

export async function setDictionaryCache(
  query: string,
  result: DictionaryResult,
  cachedAt = new Date().toISOString(),
): Promise<void> {
  const normalizedQuery = normalizeDictionaryQuery(query)
  if (!normalizedQuery) return
  await (await getDatabase()).put('dictionaryCache', {
    query: normalizedQuery,
    result,
    cachedAt,
  })
}

export async function deleteDictionaryCache(query: string): Promise<void> {
  const normalizedQuery = normalizeDictionaryQuery(query)
  if (!normalizedQuery) return
  await (await getDatabase()).delete('dictionaryCache', normalizedQuery)
}

export async function clearDictionaryCache(): Promise<void> {
  await (await getDatabase()).clear('dictionaryCache')
}

export async function writeBatch(batch: DatabaseBatch): Promise<void> {
  // Only open stores the batch actually touches; a wider transaction would
  // block concurrent readers/writers of unrelated stores.
  const stores = new Set<
    'words' | 'vocabularyLists' | 'wordListItems' | 'tracks' | 'attempts' | 'timeEntries' | 'settings' | 'dictionaryCache'
  >()
  if (batch.words?.length || batch.expectedWords?.length) stores.add('words')
  if (batch.lists?.length) stores.add('vocabularyLists')
  if (batch.memberships?.length || batch.deleteMembershipIds?.length) stores.add('wordListItems')
  if (batch.tracks?.length) stores.add('tracks')
  if (batch.attempts?.length) stores.add('attempts')
  if (batch.timeEntries?.length) stores.add('timeEntries')
  if (batch.settings) stores.add('settings')
  if (batch.dictionaryCache?.length) stores.add('dictionaryCache')
  if (stores.size === 0) return

  const database = await getDatabase()
  const transaction = database.transaction([...stores], 'readwrite')

  for (const expected of batch.expectedWords ?? []) {
    const current = await transaction.objectStore('words').get(expected.id)
    if (!sameCloudData(current, expected)) throw new Error('词条已在其他页面更新。编辑内容仍保留，请先复制修改，再重新打开词条核对。')
  }

  for (const word of batch.words ?? []) transaction.objectStore('words').put(word)
  for (const list of batch.lists ?? []) transaction.objectStore('vocabularyLists').put(list)
  for (const membership of batch.memberships ?? []) transaction.objectStore('wordListItems').put(membership)
  for (const membershipId of batch.deleteMembershipIds ?? []) {
    transaction.objectStore('wordListItems').delete(membershipId)
  }
  for (const track of batch.tracks ?? []) transaction.objectStore('tracks').put(track)
  for (const attempt of batch.attempts ?? []) transaction.objectStore('attempts').put(attempt)
  for (const entry of batch.timeEntries ?? []) transaction.objectStore('timeEntries').put(entry)
  if (batch.settings) {
    transaction.objectStore('settings').put(normalizeUserSettings(batch.settings))
  }
  for (const cacheEntry of batch.dictionaryCache ?? []) {
    const query = normalizeDictionaryQuery(cacheEntry.query)
    if (query) {
      transaction.objectStore('dictionaryCache').put({
        ...cacheEntry,
        query,
      })
    }
  }

  await transaction.done
}

export async function getUserDataSnapshot(): Promise<UserDataSnapshot> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['words', 'vocabularyLists', 'wordListItems', 'tracks', 'attempts', 'timeEntries', 'settings'],
    'readonly',
  )
  const [words, lists, memberships, tracks, attempts, timeEntries, storedSettings] = await Promise.all([
    transaction.objectStore('words').getAll(),
    transaction.objectStore('vocabularyLists').getAll(),
    transaction.objectStore('wordListItems').getAll(),
    transaction.objectStore('tracks').getAll(),
    transaction.objectStore('attempts').getAll(),
    transaction.objectStore('timeEntries').getAll(),
    transaction.objectStore('settings').get('primary'),
  ])
  await transaction.done

  const ensuredLists = lists.length > 0 ? lists : ALL_VOCABULARY_LISTS
  const settings = storedSettings
    ? normalizeUserSettings(storedSettings)
    : createDefaultSettings()

  return {
    words,
    lists: ensuredLists,
    memberships,
    vocabulary: hydrateWords(words, memberships, ensuredLists),
    tracks,
    attempts,
    timeEntries,
    settings,
  }
}

export async function replaceUserData(data: {
  words: Word[]
  lists: VocabularyList[]
  memberships: WordListItem[]
  tracks: LearningTrack[]
  attempts: ReviewAttempt[]
  timeEntries?: StudyTimeEntry[]
  settings: UserSettings
}): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['words', 'vocabularyLists', 'wordListItems', 'tracks', 'attempts', 'timeEntries', 'settings'],
    'readwrite',
  )
  const wordStore = transaction.objectStore('words')
  const listStore = transaction.objectStore('vocabularyLists')
  const membershipStore = transaction.objectStore('wordListItems')
  const trackStore = transaction.objectStore('tracks')
  const attemptStore = transaction.objectStore('attempts')
  const timeStore = transaction.objectStore('timeEntries')
  const settingsStore = transaction.objectStore('settings')

  await Promise.all([
    wordStore.clear(),
    listStore.clear(),
    membershipStore.clear(),
    trackStore.clear(),
    attemptStore.clear(),
    timeStore.clear(),
    settingsStore.clear(),
  ])

  // Queue all puts in the open transaction instead of awaiting each one.
  for (const list of data.lists) listStore.put(list)
  for (const word of data.words) wordStore.put(word)
  for (const membership of data.memberships) membershipStore.put(membership)
  for (const track of data.tracks) trackStore.put(track)
  for (const attempt of data.attempts) attemptStore.put(attempt)
  for (const entry of data.timeEntries ?? []) timeStore.put(entry)
  settingsStore.put(normalizeUserSettings(data.settings))
  await transaction.done
}

export async function clearUserData(): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['words', 'vocabularyLists', 'wordListItems', 'tracks', 'attempts', 'timeEntries', 'settings'],
    'readwrite',
  )
  await Promise.all([
    transaction.objectStore('words').clear(),
    transaction.objectStore('vocabularyLists').clear(),
    transaction.objectStore('wordListItems').clear(),
    transaction.objectStore('tracks').clear(),
    transaction.objectStore('attempts').clear(),
    transaction.objectStore('timeEntries').clear(),
    transaction.objectStore('settings').clear(),
  ])
  await transaction.done
}

export async function clearDatabase(): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(
    [
      'voiceHistory',
      'words',
      'vocabularyLists',
      'wordListItems',
      'tracks',
      'attempts',
      'timeEntries',
      'settings',
      'dictionaryCache',
    ],
    'readwrite',
  )
  await Promise.all([
    transaction.objectStore('voiceHistory').clear(),
    transaction.objectStore('words').clear(),
    transaction.objectStore('vocabularyLists').clear(),
    transaction.objectStore('wordListItems').clear(),
    transaction.objectStore('tracks').clear(),
    transaction.objectStore('attempts').clear(),
    transaction.objectStore('timeEntries').clear(),
    transaction.objectStore('settings').clear(),
    transaction.objectStore('dictionaryCache').clear(),
  ])
  await transaction.done
}

export async function closeDatabase(): Promise<void> {
  const currentDatabasePromise = databasePromise
  databasePromise = undefined
  rawDatabasePromise = undefined
  if (currentDatabasePromise) {
    const database = await currentDatabasePromise
    database.close()
  }
}

export { primaryListSlug, hydrateWord }
