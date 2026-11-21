import type { SpeechAccent, SystemListSlug, UserSettings, VocabularyLevel } from '../domain/types'
import { DEFAULT_ACTIVE_CATEGORIES } from '../domain/types'
import { buildDailyPlan } from './scheduler'

/** Display order for choosing study categories. */
export const ONBOARDING_CATEGORY_ORDER: readonly SystemListSlug[] = [
  'daily',
  'campus',
  'housing',
  'health',
  'money',
  'career',
  'food',
  'travel',
  'shopping',
  'social',
  'business',
  'finance',
  'accounting',
  'government',
  'emergency',
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
]

export interface OnboardingChoices {
  level: VocabularyLevel
  count: number
  accent: SpeechAccent
  categories: SystemListSlug[]
}

export function applyStudyCategoryOrder(settings: UserSettings, categories: readonly SystemListSlug[], now = new Date()): UserSettings {
  const changed = categories.length !== settings.activeCategories.length
    || categories.some((slug, index) => slug !== settings.activeCategories[index])
  return { ...settings, activeCategories: [...categories], learningGoal: categories[0],
    categoryPriorityChangedAt: changed ? now.toISOString() : settings.categoryPriorityChangedAt }
}

export function onboardingSettings(settings: UserSettings, choices: OnboardingChoices, now = new Date()): UserSettings {
  const activeCategories = choices.categories.length ? choices.categories : DEFAULT_ACTIVE_CATEGORIES
  return { ...applyStudyCategoryOrder(settings, activeCategories, now), vocabularyLevel: choices.level, newItemsPerDay: choices.count,
    speechAccent: choices.accent, onboardingCompletedAt: now.toISOString(), difficultyResetAt: now.toISOString() }
}

export function buildFirstLessonPlan(input: Parameters<typeof buildDailyPlan>[0]) {
  return buildDailyPlan({ ...input, newItemTarget: Math.min(3, input.settings.newItemsPerDay) })
}
