import type { SpeechAccent, SystemListSlug, UserSettings, VocabularyLevel } from '../domain/types'
import { DEFAULT_ACTIVE_CATEGORIES } from '../domain/types'
import { buildDailyPlan } from './scheduler'

export const LEARNING_GOALS: Record<SystemListSlug, string> = {
  daily: '日常生活',
  business: '商务沟通',
  finance: '金融交流',
  accounting: '会计工作',
  campus: '校园学术',
  housing: '住宿生活',
  health: '医疗健康',
  money: '个人金融',
  career: '求职职场',
  food: '餐饮美食',
  travel: '交通旅行',
  government: '政务证件',
  emergency: '应急安全',
  shopping: '购物消费',
  social: '社交文化',
  entertainment: '娱乐运动',
  digital: '数字生活',
  communication: '沟通表达',
  cs: '计算机科学',
  economics: '经济学',
  math: '数学',
  engineering: '工程学',
  medicine: '医学专业',
  law: '法学',
  psychology: '心理学',
  marketing: '市场营销',
}

/** Groups shown in onboarding: the legacy four, then scenario additions in display order. */
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
  goal: SystemListSlug
  level: VocabularyLevel
  count: number
  accent: SpeechAccent
  categories: SystemListSlug[]
}

export function onboardingSettings(settings: UserSettings, choices: OnboardingChoices, now = new Date()): UserSettings {
  const activeCategories = choices.categories.length ? choices.categories : [...DEFAULT_ACTIVE_CATEGORIES]
  return { ...settings, learningGoal: choices.goal, vocabularyLevel: choices.level, newItemsPerDay: choices.count,
    speechAccent: choices.accent, activeCategories, onboardingCompletedAt: now.toISOString(), difficultyResetAt: now.toISOString() }
}

export function buildFirstLessonPlan(input: Parameters<typeof buildDailyPlan>[0]) {
  const scenarioItems = input.items.filter(item => item.listSlugs.includes(input.settings.learningGoal ?? 'daily'))
  return buildDailyPlan({ ...input, settings: { ...input.settings, newItemsPerDay: Math.min(3, input.settings.newItemsPerDay) },
    items: scenarioItems.some(item => item.status === 'active' && !item.knownAt) ? scenarioItems : input.items })
}
