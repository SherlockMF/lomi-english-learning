import type {
  HintLevel,
  ReviewRating,
  TrackType,
  VocabularyItem,
} from '../domain/types'

export type GradeMatchKind = 'exact' | 'variant' | 'minor-typo' | 'checkpoint' | 'incorrect'

export interface GradeAttemptInput {
  item: VocabularyItem
  trackType: TrackType
  answer: string
  hintLevel?: HintLevel
  responseMs?: number
  promptIndex?: number
}

export interface GradeAttemptResult {
  correct: boolean
  rating: ReviewRating
  matchKind: GradeMatchKind
  normalizedAnswer: string
  matchedAnswer?: string
  editDistance?: number
}

const BRITISH_TO_AMERICAN: Record<string, string> = {
  analyse: 'analyze',
  analysed: 'analyzed',
  analyses: 'analyzes',
  analysing: 'analyzing',
  behaviour: 'behavior',
  behaviours: 'behaviors',
  cancelled: 'canceled',
  cancelling: 'canceling',
  centre: 'center',
  centres: 'centers',
  cheque: 'check',
  cheques: 'checks',
  colour: 'color',
  colours: 'colors',
  defence: 'defense',
  labour: 'labor',
  labours: 'labors',
  licence: 'license',
  organisation: 'organization',
  organisations: 'organizations',
  organise: 'organize',
  organised: 'organized',
  organises: 'organizes',
  organising: 'organizing',
  practise: 'practice',
  practised: 'practiced',
  practises: 'practices',
  practising: 'practicing',
  programme: 'program',
  programmes: 'programs',
  travelled: 'traveled',
  traveller: 'traveler',
  travellers: 'travelers',
  travelling: 'traveling',
}

function normalizeEnglishSurface(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(
      /^[\s('"‘“]*([a-f])\s*([+−–-])[\s)'"’”.!?]*$/,
      (_, letter, sign) => `${letter} ${sign === '+' ? 'plus' : 'minus'}`,
    )
    .replace(/[’‘`]/g, "'")
    .replace(/[.'"]/g, '')
    .replace(/[-–—_/\\]/g, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Normalizes casing, whitespace, punctuation and common UK/US spelling pairs. */
export function normalizeEnglish(value: string) {
  return normalizeEnglishSurface(value)
    .split(' ')
    .map((word) => BRITISH_TO_AMERICAN[word] ?? word)
    .join(' ')
}

/** Chinese meanings ignore presentation whitespace and punctuation, but not characters. */
export function normalizeChinese(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function unique(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function levenshtein(left: string, right: string) {
  if (left === right) return 0
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      )
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      )
    }
    previous = current
  }
  return previous[right.length]
}

function slowThreshold(trackType: TrackType) {
  if (trackType === 'receptive') return 12_000
  if (trackType === 'productive') return 15_000
  return 45_000
}

function ratingFor(
  correct: boolean,
  matchKind: GradeMatchKind,
  hintLevel: HintLevel,
  responseMs: number,
  trackType: TrackType,
): ReviewRating {
  if (!correct || hintLevel >= 2) return 'again'
  if (
    hintLevel === 1
    || matchKind === 'minor-typo'
    || (responseMs > 0 && responseMs > slowThreshold(trackType))
  ) return 'hard'
  return 'good'
}

function incorrect(normalizedAnswer: string): GradeAttemptResult {
  return {
    correct: false,
    rating: 'again',
    matchKind: 'incorrect',
    normalizedAnswer,
  }
}

function gradeChinese(input: GradeAttemptInput) {
  const submitted = normalizeChinese(input.answer)
  if (!submitted) return incorrect(submitted)
  const candidates = unique([input.item.zhGloss, ...input.item.acceptedZhAnswers])
  const match = candidates.find((candidate) => normalizeChinese(candidate) === submitted)
  if (!match) return incorrect(submitted)
  const matchKind: GradeMatchKind = match === input.item.zhGloss ? 'exact' : 'variant'
  return {
    correct: true,
    rating: ratingFor(
      true,
      matchKind,
      input.hintLevel ?? 0,
      input.responseMs ?? 0,
      input.trackType,
    ),
    matchKind,
    normalizedAnswer: submitted,
    matchedAnswer: match,
  } satisfies GradeAttemptResult
}

interface EnglishMatch {
  kind: GradeMatchKind
  answer: string
  distance?: number
}

function matchEnglish(answer: string, candidates: string[]): EnglishMatch | undefined {
  const normalized = normalizeEnglish(answer)
  const exactIndex = candidates.findIndex((candidate) => normalizeEnglish(candidate) === normalized)
  if (exactIndex >= 0) {
    return {
      kind: exactIndex === 0 ? 'exact' : 'variant',
      answer: candidates[exactIndex],
    }
  }

  const comparableLength = normalized.replace(/\s/g, '').length
  if (comparableLength < 6) return undefined
  let closest: EnglishMatch | undefined
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeEnglish(candidate)
    if (/^[a-f] (plus|minus)$/.test(normalizedCandidate)) continue
    if (Math.abs(normalizedCandidate.length - normalized.length) > 1) continue
    const distance = levenshtein(normalized, normalizedCandidate)
    if (distance <= 1 && (closest?.distance === undefined || distance < closest.distance)) {
      closest = { kind: 'minor-typo', answer: candidate, distance }
    }
  }
  return closest
}

function containsPhrase(answer: string, phrase: string) {
  const paddedAnswer = ` ${normalizeEnglish(answer)} `
  const normalizedPhrase = normalizeEnglish(phrase)
  return normalizedPhrase.length > 0 && paddedAnswer.includes(` ${normalizedPhrase} `)
}

function gradeEnglish(input: GradeAttemptInput, candidates: string[]) {
  const normalized = normalizeEnglish(input.answer)
  if (!normalized) return incorrect(normalized)
  const match = matchEnglish(input.answer, unique(candidates))
  if (!match) return incorrect(normalized)
  return {
    correct: true,
    rating: ratingFor(
      true,
      match.kind,
      input.hintLevel ?? 0,
      input.responseMs ?? 0,
      input.trackType,
    ),
    matchKind: match.kind,
    normalizedAnswer: normalized,
    matchedAnswer: match.answer,
    editDistance: match.distance,
  } satisfies GradeAttemptResult
}

function gradeUsage(input: GradeAttemptInput) {
  const prompt = input.item.usagePrompts[input.promptIndex ?? 0]
  if (!prompt) return incorrect(normalizeEnglish(input.answer))
  if (prompt.type === 'cloze') {
    return gradeEnglish(input, [
      prompt.answer ?? input.item.expression,
      input.item.expression,
      ...input.item.acceptedEnVariants,
    ])
  }

  const normalized = normalizeEnglish(input.answer)
  if (!normalized) return incorrect(normalized)
  const exactModel = normalizeEnglish(prompt.modelAnswer) === normalized
  const checkpoints = prompt.checkpoints.filter((checkpoint) => checkpoint.trim().length > 0)
  const passes = exactModel || (checkpoints.length > 0
    ? checkpoints.every((checkpoint) => containsPhrase(input.answer, checkpoint))
    : [input.item.expression, ...input.item.acceptedEnVariants]
        .some((candidate) => containsPhrase(input.answer, candidate)))
  if (!passes) return incorrect(normalized)
  const matchKind: GradeMatchKind = exactModel ? 'exact' : 'checkpoint'
  return {
    correct: true,
    rating: ratingFor(
      true,
      matchKind,
      input.hintLevel ?? 0,
      input.responseMs ?? 0,
      input.trackType,
    ),
    matchKind,
    normalizedAnswer: normalized,
    matchedAnswer: exactModel ? prompt.modelAnswer : checkpoints.join(', '),
  } satisfies GradeAttemptResult
}

/** Grades actual recall; multiple-choice recognition is intentionally not supported. */
export function gradeAttempt(input: GradeAttemptInput): GradeAttemptResult {
  if (input.trackType === 'receptive') return gradeChinese(input)
  if (input.trackType === 'usage') return gradeUsage(input)
  return gradeEnglish(input, [input.item.expression, ...input.item.acceptedEnVariants])
}
