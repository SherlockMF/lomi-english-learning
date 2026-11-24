import type { VocabularyExample, Word } from '../domain/types'
import { escapeRegExp } from './text'

export interface WordCorrection {
  expression: string
  zhGloss: string
  enDefinition: string
  example: VocabularyExample
}

export function replaceCorrectedExpression(text: string, original: string, replacement: string): string {
  if (!original || !replacement || original === replacement) return text
  const pattern = new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegExp(original) + '(?![\\p{L}\\p{N}])', 'giu')
  return text.replace(pattern, (match) => /^[A-Z]/u.test(match) && /^[a-z]/u.test(replacement)
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement)
}

export function reviseCorrectionExample(
  example: VocabularyExample,
  original: Pick<Word, 'expression' | 'zhGloss'>,
  expression: string,
  zhGloss: string,
): VocabularyExample {
  return {
    en: replaceCorrectedExpression(example.en, original.expression, expression),
    zh: original.zhGloss && zhGloss ? example.zh.replaceAll(original.zhGloss, () => zhGloss) : example.zh,
  }
}
