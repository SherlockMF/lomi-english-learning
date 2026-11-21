import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS, hydrateWord } from '../domain/types'
import { handcraftedSeedWords } from '../data/seedVocabulary'
import { createInitialTracks } from './scheduler'
import { validateSettings } from './backup'
import { buildFirstLessonPlan, onboardingSettings } from './onboarding'

it('persists onboarding choices through backup validation and accepts old settings', () => {
  const result = onboardingSettings(DEFAULT_SETTINGS, { goal: 'business', level: 'A2', count: 3, accent: 'us', categories: ['daily', 'business', 'campus'] }, new Date('2026-10-30T00:00:00Z'))
  expect(validateSettings(result, '$')).toMatchObject({ onboardingCompletedAt: '2026-10-30T00:00:00.000Z', learningGoal: 'business', vocabularyLevel: 'A2', newItemsPerDay: 3, speechAccent: 'us', activeCategories: ['daily', 'business', 'campus'] })
  expect(validateSettings(DEFAULT_SETTINGS, '$').onboardingCompletedAt).toBeUndefined()
})

it('falls back to the default categories when onboarding selects none', () => {
  const result = onboardingSettings(DEFAULT_SETTINGS, { goal: 'daily', level: 'B1', count: 5, accent: 'uk', categories: [] }, new Date('2026-10-30T00:00:00Z'))
  expect(result.activeCategories).toEqual(DEFAULT_SETTINGS.activeCategories)
})

it('limits the first lesson to three expressions in the selected scenario', () => {
  const items = handcraftedSeedWords.slice(0, 10).map((word, index) => hydrateWord(word, [index < 6 ? 'business' : 'daily']))
  const now = new Date()
  const plan = buildFirstLessonPlan({ settings: { ...DEFAULT_SETTINGS, learningGoal: 'business', newItemsPerDay: 10 }, items,
    tracks: createInitialTracks(items, now), attempts: [], timeEntries: [], now })
  expect(plan.newItemCount).toBe(3)
  expect(new Set(plan.tasks.map(task => task.itemId)).size).toBe(3)
  expect(plan.tasks.every(task => items.find(item => item.id === task.itemId)?.category === 'business')).toBe(true)
})
