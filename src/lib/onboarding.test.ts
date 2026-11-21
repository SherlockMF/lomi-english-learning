import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS, hydrateWord } from '../domain/types'
import { handcraftedSeedWords } from '../data/seedVocabulary'
import { createInitialTracks } from './scheduler'
import { validateSettings } from './backup'
import { buildFirstLessonPlan, onboardingSettings } from './onboarding'

it('persists onboarding choices through backup validation and accepts old settings', () => {
  const result = onboardingSettings(DEFAULT_SETTINGS, { level: 'A2', count: 3, accent: 'us', categories: ['campus', 'business', 'daily'] }, new Date('2026-10-30T00:00:00Z'))
  expect(validateSettings(result, '$')).toMatchObject({ onboardingCompletedAt: '2026-10-30T00:00:00.000Z', categoryPriorityChangedAt: '2026-10-30T00:00:00.000Z', learningGoal: 'campus', vocabularyLevel: 'A2', newItemsPerDay: 3, speechAccent: 'us', activeCategories: ['campus', 'business', 'daily'] })
  expect(validateSettings(DEFAULT_SETTINGS, '$').onboardingCompletedAt).toBeUndefined()
})

it('falls back to the default categories when onboarding selects none', () => {
  const result = onboardingSettings(DEFAULT_SETTINGS, { level: 'B1', count: 5, accent: 'uk', categories: [] }, new Date('2026-10-30T00:00:00Z'))
  expect(result.activeCategories).toEqual(DEFAULT_SETTINGS.activeCategories)
})

it('uses the ranked categories in the first three-expression lesson', () => {
  const items = handcraftedSeedWords.slice(0, 10).map((word, index) => hydrateWord({ ...word, vocabularyLevel: 'B1' }, [index < 6 ? 'business' : 'daily']))
  const now = new Date()
  const plan = buildFirstLessonPlan({ settings: { ...DEFAULT_SETTINGS, learningGoal: 'business', activeCategories: ['business', 'daily'], newItemsPerDay: 10 }, items,
    tracks: createInitialTracks(items, now), attempts: [], timeEntries: [], now })
  expect(plan.newItemCount).toBe(3)
  expect(new Set(plan.tasks.map(task => task.itemId)).size).toBe(3)
  const firstLessonIds = new Set(plan.tasks.map(task => task.itemId))
  expect(items.filter(item => firstLessonIds.has(item.id) && item.category === 'business')).toHaveLength(2)
  expect(items.filter(item => firstLessonIds.has(item.id) && item.category === 'daily')).toHaveLength(1)
})
