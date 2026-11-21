import type { LearningTrack, ListSlug, ReviewAttempt, TrackType, VocabularyItem, Word } from '../domain/types'
import { deriveLearningEvidence } from './learningEvidence'

export function recallContext(item: Pick<Word, 'examples' | 'enDefinition' | 'collocations'>): string {
  return item.examples.find((example) => example.en.trim())?.en.trim()
    || item.enDefinition.trim() || item.collocations.find((value) => value.trim())?.trim() || ''
}

export const categoryLabels: Record<ListSlug | 'other', string> = {
  daily: '日常生活',
  business: '商业英语',
  finance: '金融英语',
  accounting: '会计英语',
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
  'my-vocabulary': '优先学习',
  other: '其他',
}

export const trackLabels: Record<TrackType, string> = {
  receptive: '理解意思',
  productive: '主动表达',
  usage: '场景应用',
}

export function greetingFor(date: Date) {
  const hour = date.getHours()
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function formatToday(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
}

export type ItemStageKey = 'new' | 'learning' | 'usable' | 'solid'

/** One-pass index so stage lookups stay O(tracks for item), not O(all tracks). */
export function groupTracksByItemId(
  tracks: readonly LearningTrack[],
): Map<string, LearningTrack[]> {
  const byItem = new Map<string, LearningTrack[]>()
  for (const track of tracks) {
    const current = byItem.get(track.itemId)
    if (current) current.push(track)
    else byItem.set(track.itemId, [track])
  }
  return byItem
}

/**
 * Compatibility stage keys for older callers; all state comes from saved learning evidence.
 * Prefer the shared LearningStats.evidenceByItemId projection on hot paths.
 */
export function getItemStage(
  item: VocabularyItem,
  tracks: LearningTrack[],
  attempts: ReviewAttempt[] = [],
  now: Date = new Date(),
): { key: ItemStageKey; label: string } {
  const evidence = deriveLearningEvidence(item, tracks, attempts, now)
  const key = evidence.key === 'recall' ? 'usable' : evidence.key === 'retained' ? 'solid' : evidence.key
  return { key, label: evidence.label }
}

export function expressionHint(expression: string, level: number) {
  const words = expression.split(/\s+/)
  if (level <= 0) return ''
  if (level === 1) {
    return words.map((word) => `${word[0] ?? ''}${'·'.repeat(Math.max(1, word.length - 1))}`).join(' ')
  }
  return `${words.length} 个词 / ${expression.length} 个字符`
}
