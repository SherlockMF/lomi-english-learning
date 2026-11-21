import { SEED_CONTENT_REVISION } from '../data/seedContentRevision'

export type SystemListSlug =
  | 'daily'
  | 'business'
  | 'finance'
  | 'accounting'
  | 'campus'
  | 'housing'
  | 'health'
  | 'money'
  | 'career'
  | 'food'
  | 'travel'
  | 'government'
  | 'emergency'
  | 'shopping'
  | 'social'
  | 'entertainment'
  | 'digital'
  | 'communication'
  | 'cs'
  | 'economics'
  | 'math'
  | 'engineering'
  | 'medicine'
  | 'law'
  | 'psychology'
  | 'marketing'
export type ListSlug = SystemListSlug | 'my-vocabulary'
export type VocabularySource = 'seed' | 'dictionary' | 'custom'
export type VocabularyStatus = 'active' | 'paused'
export type TrackType = 'receptive' | 'productive' | 'usage'
export type ReviewRating = 'again' | 'hard' | 'good'
export type HintLevel = 0 | 1 | 2 | 3
export type SpeechAccent = 'uk' | 'us'
export const VOCABULARY_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export type VocabularyLevel = (typeof VOCABULARY_LEVELS)[number]

export interface VocabularyExample {
  en: string
  zh: string
}

export interface UsagePrompt {
  id: string
  type: 'cloze' | 'sentence'
  prompt: string
  answer?: string
  modelAnswer: string
  checkpoints: string[]
}

/** Canonical lexical sense stored in IndexedDB `words` (id preserved across migrations). */
export interface Word {
  id: string
  expression: string
  lemma: string
  senseKey: string
  zhGloss: string
  enDefinition: string
  partOfSpeech: string
  acceptedZhAnswers: string[]
  acceptedEnVariants: string[]
  examples: VocabularyExample[]
  collocations: string[]
  source: VocabularySource
  priority: number
  status: VocabularyStatus
  /** Self-reported knowledge; does not create recall evidence or delete history. */
  knownAt?: string
  /** Optional personal override for lexical difficulty, separate from FSRS difficulty. */
  vocabularyLevel?: VocabularyLevel
  /** Explicit personal content changes; absent on legacy records. */
  contentEdited?: boolean
  ipaUk?: string
  ipaUs?: string
  audioUk?: string
  audioUs?: string
  synonyms?: string[]
  antonyms?: string[]
  usagePrompts: UsagePrompt[]
  createdAt: string
  updatedAt: string
}

/**
 * Hydrated study view: Word plus list membership.
 * `category` is the primary list slug for scheduler/contentMix (not stored on Word).
 */
export interface VocabularyItem extends Word {
  listSlugs: ListSlug[]
  category: ListSlug
  /** Free-text scenario note when the item is filed under a custom “其他” context. */
  scenarioNote?: string
}

export interface VocabularyList {
  id: string
  name: string
  slug: ListSlug
  description: string
  category: ListSlug
  isSystem: boolean
  createdAt: string
}

export interface WordListItem {
  id: string
  wordId: string
  listId: string
  priority: number
  subcategory?: string
  sortOrder: number
}

export interface LearningTrack {
  id: string
  itemId: string
  type: TrackType
  due: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  state: number
  lastReview?: string
  firstGoodAt?: string
  lastGoodAt?: string
  unlocked: boolean
}

export interface ReviewAttempt {
  /** Scheduling inputs retained for deterministic cross-device conflict replay. */
  desiredRetention?: number
  trackBefore?: LearningTrack
  id: string
  trackId: string
  itemId: string
  trackType: TrackType
  promptType: string
  answer: string
  rating: ReviewRating
  hintLevel: HintLevel
  responseMs: number
  reviewedAt: string
  wasOverride?: boolean
  /** Absent on legacy attempts: do not infer objective learning evidence from ratings. */
  evidenceVersion?: 1
  sessionId?: string
  retryCount?: number
  promptId?: string
  evaluationSource?: 'rules' | 'llm' | 'reveal'
  correctness?: 'correct' | 'incorrect' | 'unverified'
  matchKind?: 'exact' | 'variant' | 'minor-typo' | 'checkpoint' | 'incorrect'
  suggestedRating?: ReviewRating
  wasPriorityStudy?: boolean
  wasNewItem?: boolean
}

export interface StudyTimeEntry {
  id: string
  sessionId: string
  localDate: string
  activeMs: number
  updatedAt: string
}

export interface UserSettings {
  id: 'primary'
  dailyMinutes: number
  /** Legacy settings retained for backup compatibility. */
  coreMinutes: number
  extensionMinutes: number
  desiredRetention: number
  /** System categories whose words may enter the ordinary new-item rotation. */
  activeCategories: SystemListSlug[]
  newItemsPerDay: number
  /** Legacy backup field; new-word scheduling uses fixed daily/business/finance/accounting weights. */
  contentMix: Record<SystemListSlug, number>
  /** Preferred UK/US accent for study playback. */
  speechAccent: SpeechAccent
  vocabularyLevel?: VocabularyLevel
  adaptiveDifficulty?: boolean
  difficultyResetAt?: string
  onboardingCompletedAt?: string
  learningGoal?: SystemListSlug
  /**
   * When this differs from the app’s bundled `SEED_CONTENT_REVISION`,
   * `initializeDatabase` refreshes seed Word bodies by id (tracks kept).
   */
  seedContentRevision?: string
  /** Supplemental dictionary senses are merged without refreshing seed bodies. */
  dictionaryContentRevision?: string
  lastBackupAt?: string
}

export interface DictionaryMeaning {
  /** Exact automated source definition withdrawn by a verified content correction. */
  supersededDefinition?: string
  /** Stable source identity retained when a learner edits this meaning before saving. */
  senseKey?: string
  partOfSpeech: string
  definition: string
  /** Short Chinese gloss for this sense, when a bilingual source provided one. */
  zhGloss?: string
  example?: string
  exampleZh?: string
  synonyms: string[]
  collocations?: string[]
  antonyms?: string[]
}

export interface DictionaryResult {
  /** Cache schema marker — ignore older entries that lack bilingual senses. */
  schemaVersion?: number
  query: string
  word: string
  phonetic?: string
  audioUrl?: string
  ipaUk?: string
  ipaUs?: string
  audioUk?: string
  audioUs?: string
  meanings: DictionaryMeaning[]
  fetchedAt: string
}

export interface DictionaryCache {
  query: string
  result: DictionaryResult
  cachedAt: string
}

export interface BackupV1 {
  version: 1
  exportedAt: string
  vocabulary: Array<Word & {
    category: ListSlug | 'custom'
    phonetic?: string
    audioUrl?: string
    listSlugs?: ListSlug[]
  }>
  tracks: LearningTrack[]
  attempts: ReviewAttempt[]
  settings: UserSettings & { contentMix: Record<string, number> }
}

export interface BackupV2 {
  version: 2
  exportedAt: string
  words: Word[]
  lists: VocabularyList[]
  memberships: WordListItem[]
  tracks: LearningTrack[]
  attempts: ReviewAttempt[]
  settings: UserSettings
}

export interface BackupV3 extends Omit<BackupV2, 'version'> {
  version: 3
  timeEntries: StudyTimeEntry[]
}

/** Vocabulary-only pack (no learning progress). Distinct from BackupV1/V2. */
export interface VocabularyPackV1 {
  version: 1
  kind: 'vocabulary-pack'
  exportedAt: string
  words: Word[]
  lists: VocabularyList[]
  memberships: WordListItem[]
}

export interface SessionTask {
  id: string
  itemId: string
  trackId: string
  trackType: TrackType
  isNew: boolean
  promptIndex?: number
  retryCount?: number
}

export interface SessionSummary {
  total: number
  noHintGood: number
  again: number
  usageCompleted: number
  usableThisWeek: number
}

export const SYSTEM_LIST_ORDER: readonly SystemListSlug[] = [
  'daily',
  'business',
  'finance',
  'accounting',
  'campus',
  'housing',
  'health',
  'money',
  'career',
  'food',
  'travel',
  'government',
  'emergency',
  'shopping',
  'social',
  'entertainment',
  'digital',
  'communication',
  'cs',
  'economics',
  'math',
  'engineering',
  'medicine',
  'law',
  'psychology',
  'marketing',
] as const

/** Every selectable list slug, for schema validators that pin slugs literally. */
export const ALL_LIST_SLUGS = [...SYSTEM_LIST_ORDER, 'my-vocabulary'] as const satisfies readonly ListSlug[]

/** Categories included in ordinary new-item rotation before the user opts in to more. */
export const DEFAULT_ACTIVE_CATEGORIES: readonly SystemListSlug[] = [
  'daily',
  'business',
  'finance',
  'accounting',
]

export const DEFAULT_SETTINGS: UserSettings = {
  id: 'primary',
  dailyMinutes: 15,
  coreMinutes: 15,
  extensionMinutes: 15,
  desiredRetention: 0.9,
  newItemsPerDay: 5,
  contentMix: {
    daily: 0.35,
    business: 0.25,
    finance: 0.2,
    accounting: 0.2,
    campus: 0,
    housing: 0,
    health: 0,
    money: 0,
    career: 0,
    food: 0,
    travel: 0,
    government: 0,
    emergency: 0,
    shopping: 0,
    social: 0,
    entertainment: 0,
    digital: 0,
    communication: 0,
    cs: 0,
    economics: 0,
    math: 0,
    engineering: 0,
    medicine: 0,
    law: 0,
    psychology: 0,
    marketing: 0,
  },
  activeCategories: [...DEFAULT_ACTIVE_CATEGORIES],
  speechAccent: 'uk',
  vocabularyLevel: 'B1',
  adaptiveDifficulty: true,
  // Single source of truth for the seed stamp lives in seedContentRevision.
  seedContentRevision: SEED_CONTENT_REVISION,
}

export function normalizeLemma(expression: string): string {
  return expression.trim().toLocaleLowerCase('en-US')
}

export function primaryListSlug(listSlugs: ListSlug[]): ListSlug {
  for (const slug of SYSTEM_LIST_ORDER) {
    if (listSlugs.includes(slug)) return slug
  }
  if (listSlugs.includes('my-vocabulary')) return 'my-vocabulary'
  return 'my-vocabulary'
}

export function hydrateWord(
  word: Word,
  listSlugs: ListSlug[],
  scenarioNote?: string,
): VocabularyItem {
  return {
    ...word,
    listSlugs,
    category: primaryListSlug(listSlugs),
    scenarioNote: scenarioNote?.trim() || undefined,
  }
}
