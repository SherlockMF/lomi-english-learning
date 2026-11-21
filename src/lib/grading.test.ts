import type { VocabularyItem } from '../domain/types'
import { gradeAttempt, normalizeChinese, normalizeEnglish } from './grading'

function makeItem(overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: 'cash-flow',
    expression: 'cash flow',
    lemma: 'cash flow',
    senseKey: 'cash-flow-noun',
    zhGloss: '现金流',
    enDefinition: 'money moving into and out of a business',
    partOfSpeech: 'noun',
    acceptedZhAnswers: ['现金流量'],
    acceptedEnVariants: ['cashflow'],
    examples: [],
    collocations: ['positive cash flow'],
    listSlugs: ['finance'],
    category: 'finance',
    source: 'seed',
    priority: 1,
    status: 'active',
    usagePrompts: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('normalization', () => {
  it('ignores English case, spacing and presentation punctuation', () => {
    expect(normalizeEnglish('  CASH--Flow!! ')).toBe('cash flow')
    expect(normalizeEnglish('U.S.  market')).toBe('us market')
  })

  it('canonicalizes common British and American variants', () => {
    expect(normalizeEnglish('financial centres')).toBe('financial centers')
    expect(normalizeEnglish('organized labor')).toBe('organized labor')
    expect(normalizeEnglish('organised labour')).toBe('organized labor')
  })

  it('ignores Chinese whitespace and punctuation without dropping characters', () => {
    expect(normalizeChinese(' 现 金 流！')).toBe('现金流')
    expect(normalizeChinese('现金流量')).not.toBe(normalizeChinese('现金流'))
  })
})

describe('gradeAttempt', () => {
  it('grades productive exact answers and configured variants', () => {
    const item = makeItem()
    expect(gradeAttempt({
      item,
      trackType: 'productive',
      answer: '  CASH-FLOW! ',
      responseMs: 4_000,
    })).toMatchObject({ correct: true, rating: 'good', matchKind: 'exact' })
    expect(gradeAttempt({
      item,
      trackType: 'productive',
      answer: 'cashflow',
    })).toMatchObject({ correct: true, rating: 'good', matchKind: 'variant' })
  })

  it('accepts built-in UK/US spelling equivalence', () => {
    const item = makeItem({ expression: 'financial centre', acceptedEnVariants: [] })
    expect(gradeAttempt({
      item,
      trackType: 'productive',
      answer: 'Financial Center',
    })).toMatchObject({ correct: true, rating: 'good' })
  })

  it.each([
    ['B plus', 'B+', 'B-', 'A+'],
    ['C minus', 'C−', 'C+', 'B-'],
  ])('keeps both the letter and the sign when grading %s', (expression, correctAnswer, oppositeSign, wrongLetter) => {
    const item = makeItem({ expression, acceptedEnVariants: [correctAnswer] })
    expect(gradeAttempt({ item, trackType: 'productive', answer: correctAnswer }).correct).toBe(true)
    expect(gradeAttempt({ item, trackType: 'productive', answer: oppositeSign }).correct).toBe(false)
    expect(gradeAttempt({ item, trackType: 'productive', answer: wrongLetter }).correct).toBe(false)
    expect(gradeAttempt({ item, trackType: 'productive', answer: expression[0] }).correct).toBe(false)
  })

  it('accepts the minus sign in commonly formatted letter grades', () => {
    expect(normalizeEnglish('“C–”')).toBe('c minus')
    expect(normalizeEnglish('(B+)')).toBe('b plus')
  })

  it('marks one minor typo as hard but does not forgive short confusable finance words', () => {
    const entrepreneur = makeItem({ expression: 'entrepreneur', acceptedEnVariants: [] })
    expect(gradeAttempt({
      item: entrepreneur,
      trackType: 'productive',
      answer: 'entrepreneu',
    })).toMatchObject({
      correct: true,
      rating: 'hard',
      matchKind: 'minor-typo',
      editDistance: 1,
    })

    const debt = makeItem({ expression: 'debt', acceptedEnVariants: [] })
    expect(gradeAttempt({
      item: debt,
      trackType: 'productive',
      answer: 'debit',
    })).toMatchObject({ correct: false, rating: 'again' })
  })

  it('downgrades answers that are slow or use hints', () => {
    const item = makeItem()
    expect(gradeAttempt({
      item,
      trackType: 'productive',
      answer: 'cash flow',
      responseMs: 16_000,
    }).rating).toBe('hard')
    expect(gradeAttempt({
      item,
      trackType: 'productive',
      answer: 'cash flow',
      hintLevel: 1,
    }).rating).toBe('hard')
    expect(gradeAttempt({
      item,
      trackType: 'productive',
      answer: 'cash flow',
      hintLevel: 2,
    })).toMatchObject({ correct: true, rating: 'again' })
  })

  it('grades receptive Chinese against the gloss and accepted alternatives', () => {
    const item = makeItem()
    expect(gradeAttempt({
      item,
      trackType: 'receptive',
      answer: ' 现 金 流！',
    })).toMatchObject({ correct: true, rating: 'good', matchKind: 'exact' })
    expect(gradeAttempt({
      item,
      trackType: 'receptive',
      answer: '现金流量',
    })).toMatchObject({ correct: true, rating: 'good', matchKind: 'variant' })
    expect(gradeAttempt({
      item,
      trackType: 'receptive',
      answer: '利润',
    })).toMatchObject({ correct: false, rating: 'again' })
  })

  it('grades cloze answers and open usage checkpoints', () => {
    const item = makeItem({
      usagePrompts: [
        {
          id: 'cloze',
          type: 'cloze',
          prompt: 'Positive ___ keeps a company liquid.',
          answer: 'cash flow',
          modelAnswer: 'Positive cash flow keeps a company liquid.',
          checkpoints: ['cash flow'],
        },
        {
          id: 'sentence',
          type: 'sentence',
          prompt: 'Write a sentence about a healthy company.',
          modelAnswer: 'The company has positive cash flow.',
          checkpoints: ['positive', 'cash flow'],
        },
      ],
    })
    expect(gradeAttempt({
      item,
      trackType: 'usage',
      promptIndex: 0,
      answer: 'Cash-flow',
    })).toMatchObject({ correct: true, rating: 'good' })
    expect(gradeAttempt({
      item,
      trackType: 'usage',
      promptIndex: 1,
      answer: 'Our positive cash flow lets us invest.',
    })).toMatchObject({ correct: true, rating: 'good', matchKind: 'checkpoint' })
    expect(gradeAttempt({
      item,
      trackType: 'usage',
      promptIndex: 1,
      answer: 'The company is healthy.',
    })).toMatchObject({ correct: false, rating: 'again' })
  })
})
