import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_ACTIVE_CATEGORIES, type VocabularyItem } from '../domain/types'
import type { LearningEvidence } from '../lib/learningEvidence'
import { LibraryView } from './LibraryView'

vi.mock('../lib/speech', () => ({ speakWord: vi.fn(), speakExample: vi.fn() }))
afterEach(cleanup)
const sense: VocabularyItem = {
  id: 'interest-money', expression: 'interest', lemma: 'interest', senseKey: 'money', zhGloss: '利息',
  enDefinition: 'money paid on a loan', partOfSpeech: 'noun', acceptedZhAnswers: [], acceptedEnVariants: [],
  examples: [{ en: 'The loan carries interest.', zh: '这笔贷款需要支付利息。' }], collocations: [], source: 'seed', priority: 1, status: 'active', usagePrompts: [],
  listSlugs: ['finance'], category: 'finance', createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
}
function props(items: VocabularyItem[]) {
  return { items, activeCategories: DEFAULT_ACTIVE_CATEGORIES, onSaveStudyCategories: vi.fn().mockResolvedValue(undefined),
    evidenceByItemId: new Map(), onToggleStatus: vi.fn().mockResolvedValue(undefined),
    onToggleKnown: vi.fn().mockResolvedValue(undefined), onUpdate: vi.fn(),
    onAddToMyVocabulary: vi.fn().mockResolvedValue({ ok: true, message: '已加入优先学习' }),
    onRemoveFromMyVocabulary: vi.fn().mockResolvedValue({ ok: true, message: '已移除优先学习' }) }
}

const curiosity: VocabularyItem = { ...sense, id: 'interest-curiosity', zhGloss: '兴趣', status: 'paused',
  examples: [{ en: 'She has an interest in art.', zh: '她对艺术感兴趣。' }] }
const evidence: LearningEvidence = { key: 'recall', label: '双向可回忆', legacyEvidence: false,
  directions: { receptive: { label: '无提示成功', retained: false, details: [], missing: ['尚缺间隔验证'] },
    productive: { label: '无提示成功', retained: false, details: [], missing: ['尚缺间隔验证'] } },
  application: { label: '尚未验证', clozePassed: false, sentencePassed: false, details: [] }, explanations: [] }

it('groups a word while keeping sense-specific actions and search results', async () => {
  const user = userEvent.setup()
  const callbacks = props([sense, curiosity])
  render(<LibraryView {...callbacks} evidenceByItemId={new Map([[sense.id, evidence]])} />)
  expect(screen.getAllByRole('heading', { name: 'interest' })).toHaveLength(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText(sense.examples[0].en)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '查看 interest：利息' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(sense.examples[0].en)).toBeInTheDocument()
  expect(within(dialog).getAllByText('无提示成功')).toHaveLength(2)
  dialog.querySelector('.word-detail-content')!.scrollTop = 120
  await user.click(within(dialog).getByRole('button', { name: '选择义项 2：兴趣' }))
  expect(dialog.querySelector('.word-detail-content')!.scrollTop).toBe(0)
  expect(within(dialog).getByText(curiosity.examples[0].en)).toBeInTheDocument()
  expect(within(dialog).queryByText(sense.examples[0].en)).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: '恢复 interest：兴趣' }))
  expect(callbacks.onToggleStatus).toHaveBeenCalledWith(curiosity)
  await user.click(within(dialog).getByRole('button', { name: '关闭词条详情' }))
  await user.type(screen.getByLabelText('搜索词库'), '利息')
  expect(screen.getByText('利息')).toBeInTheDocument()
  expect(screen.queryByText('兴趣')).not.toBeInTheDocument()
})

it('completes senses only on request and reports a lookup failure', async () => {
  const user = userEvent.setup()
  const complete = vi.fn().mockRejectedValue(new Error('当前离线且无缓存'))
  render(<LibraryView {...props([sense])} onCompleteSenses={complete} />)
  expect(complete).not.toHaveBeenCalled()
  const card = screen.getByRole('heading', { name: 'interest' }).closest('article')!
  await user.click(within(card).getByRole('button', { name: '查看 interest 的详情' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '补全词义 interest' }))
  expect(complete).toHaveBeenCalledWith(sense)
  expect(await screen.findByText('当前离线且无缓存')).toBeInTheDocument()
})

it('previews at most three meanings and retains a selected later sense after refreshed data', async () => {
  const user = userEvent.setup()
  const items = Array.from({ length: 7 }, (_, index) => ({ ...sense, id: `interest-${index}`, zhGloss: `义项${index + 1}` }))
  const callbacks = props(items)
  const view = render(<LibraryView {...callbacks} />)
  const card = screen.getByRole('heading', { name: 'interest' }).closest('article')!
  expect(within(card).getAllByRole('button', { name: /^查看 interest：/ })).toHaveLength(3)
  await user.click(within(card).getByRole('button', { name: '查看 interest 的详情' }))
  await user.click(screen.getByRole('button', { name: '选择义项 7：义项7' }))
  view.rerender(<LibraryView {...callbacks} items={[...items, { ...sense, id: 'new', zhGloss: '新增义项' }]} />)
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('button', { name: '选择义项 7：义项7' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(dialog).getByRole('button', { name: '选择义项 8：新增义项' })).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: '关闭词条详情' }))
  expect(within(card).getAllByRole('button', { name: /^查看 interest：/ })).toHaveLength(3)
  expect(within(card).getByRole('button', { name: '查看 interest：义项7' })).toHaveAttribute('aria-pressed', 'true')
})

it('opens the full entry even when search matches only one sense', async () => {
  const user = userEvent.setup()
  render(<LibraryView {...props([sense, curiosity])} />)
  await user.type(screen.getByLabelText('搜索词库'), '兴趣')
  expect(screen.queryByRole('button', { name: '查看 interest：利息' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '查看 interest 全部 2 个义项' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '查看 interest：兴趣' }))
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: '选择义项 1：利息' })).toBeInTheDocument()
})

it('filters words by installed expansion lists', async () => {
  const user = userEvent.setup()
  const housingWord: VocabularyItem = {
    ...sense, id: 'housing-lease', expression: 'lease', lemma: 'lease', senseKey: 'housing-contract',
    zhGloss: '租约', listSlugs: ['housing'], category: 'housing',
  }
  render(<LibraryView {...props([sense, housingWord])} />)

  const categories = screen.getByRole('combobox', { name: '扩展词库分类' })
  expect(within(categories).queryByRole('option', { name: '餐饮美食' })).not.toBeInTheDocument()
  await user.selectOptions(categories, 'housing')
  expect(screen.getByRole('heading', { name: 'lease' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'interest' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '金融英语' }))
  expect(categories).toHaveValue('all')
  expect(screen.getByRole('heading', { name: 'interest' })).toBeInTheDocument()
})

it('closes with Escape, restores focus and releases the body scroll lock', async () => {
  const user = userEvent.setup()
  render(<LibraryView {...props([sense])} />)
  const trigger = screen.getByRole('button', { name: '查看 interest 的详情' })
  await user.click(trigger)
  expect(document.body.style.overflow).toBe('hidden')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(document.body.style.overflow).not.toBe('hidden')
})

it('reports action failures inside the dialog and prevents training an untranslated sense', async () => {
  const user = userEvent.setup()
  const untranslated = { ...curiosity, zhGloss: '', enDefinition: 'to attract attention' }
  const callbacks = props([sense, untranslated])
  callbacks.onAddToMyVocabulary.mockRejectedValue(new Error('保存优先学习失败'))
  render(<LibraryView {...callbacks} />)
  await user.click(screen.getByRole('button', { name: '查看 interest：利息' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '加入优先学习 interest：利息' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('保存优先学习失败')
  await user.click(screen.getByRole('button', { name: '选择义项 2：to attract attention' }))
  expect(screen.getByRole('button', { name: '恢复 interest：to attract attention' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '加入优先学习 interest：to attract attention' })).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('edits the selected sense and returns to its details without losing the selection', async () => {
  const user = userEvent.setup()
  const callbacks = props([sense, curiosity])
  callbacks.onUpdate.mockResolvedValue(undefined)
  render(<LibraryView {...callbacks} />)
  await user.click(screen.getByRole('button', { name: '查看 interest：兴趣' }))
  await user.click(screen.getByRole('button', { name: '编辑 interest：兴趣' }))
  const editor = screen.getByRole('dialog')
  await user.selectOptions(within(editor).getByLabelText('词汇难度'), 'C2')
  await user.click(within(editor).getByRole('button', { name: '保存修改' }))
  expect(callbacks.onUpdate).toHaveBeenCalledWith(curiosity.id, expect.objectContaining({ vocabularyLevel: 'C2' }))
  expect(await screen.findByRole('button', { name: '选择义项 2：兴趣' })).toHaveAttribute('aria-pressed', 'true')
})

it('preserves the other examples when only the difficulty or the first example is edited', async () => {
  const user = userEvent.setup()
  const examples = [...curiosity.examples, { en: 'His interest in music grew.', zh: '他对音乐的兴趣增长了。' }]
  const callbacks = props([{ ...curiosity, examples }])
  render(<LibraryView {...callbacks} />)
  await user.click(screen.getByRole('button', { name: '查看 interest 的详情' }))
  await user.click(screen.getByRole('button', { name: '编辑 interest' }))
  await user.selectOptions(within(screen.getByRole('dialog')).getByLabelText('词汇难度'), 'C2')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  expect(callbacks.onUpdate).toHaveBeenCalledWith(curiosity.id, expect.objectContaining({ examples }))
})

it('removes only the first example when the first example text is cleared', async () => {
  const user = userEvent.setup()
  const retained = { en: 'His interest in music grew.', zh: '他对音乐的兴趣增长了。' }
  const callbacks = props([{ ...curiosity, examples: [...curiosity.examples, retained] }])
  render(<LibraryView {...callbacks} />)
  await user.click(screen.getByRole('button', { name: '查看 interest 的详情' }))
  await user.click(screen.getByRole('button', { name: '编辑 interest' }))
  await user.clear(within(screen.getByRole('dialog')).getByLabelText('英文例句'))
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  expect(callbacks.onUpdate).toHaveBeenCalledWith(curiosity.id, expect.objectContaining({ examples: [retained] }))
})

it('restores focus to the word when selecting a later sense replaces the original trigger', async () => {
  const user = userEvent.setup()
  const items = Array.from({ length: 4 }, (_, index) => ({ ...sense, id: `interest-${index}`, zhGloss: `义项${index + 1}` }))
  render(<LibraryView {...props(items)} />)
  const trigger = screen.getByRole('button', { name: '查看 interest：义项3' })
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: '选择义项 4：义项4' }))
  expect(trigger.isConnected).toBe(false)
  await user.click(screen.getByRole('button', { name: '关闭词条详情' }))
  expect(screen.getByRole('button', { name: '查看 interest 的详情' })).toHaveFocus()
})

it('keeps Tab focus inside the dialog while the selected action is disabled by a pending save', async () => {
  const user = userEvent.setup()
  const callbacks = props([sense])
  let finish = () => {}
  callbacks.onAddToMyVocabulary.mockImplementation(() => new Promise((resolve) => {
    finish = () => resolve({ ok: true, message: '已加入优先学习' })
  }))
  render(<LibraryView {...callbacks} />)
  await user.click(screen.getByRole('button', { name: '查看 interest 的详情' }))
  const dialog = screen.getByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: '加入优先学习 interest' }))
  await user.tab()
  expect(dialog.contains(document.activeElement)).toBe(true)
  await act(async () => finish())
})

it('allows Tab past the evidence summary to reach the dialog actions', async () => {
  const user = userEvent.setup()
  render(<LibraryView {...props([sense])} evidenceByItemId={new Map([[sense.id, evidence]])} />)
  await user.click(screen.getByRole('button', { name: '查看 interest 的详情' }))
  const summary = screen.getByText('学习依据与最近记录').closest('summary')!
  summary.focus()
  await user.tab()
  expect(screen.getByRole('button', { name: '暂停 interest' })).toHaveFocus()
})

it('does not close a reopened editor when an earlier save completes', async () => {
  const user = userEvent.setup()
  const callbacks = props([sense])
  let finish = () => {}
  callbacks.onUpdate.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  render(<LibraryView {...callbacks} />)
  await user.click(screen.getByRole('button', { name: '查看 interest 的详情' }))
  await user.click(screen.getByRole('button', { name: '编辑 interest' }))
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await user.click(screen.getByRole('button', { name: '取消' }))
  await user.click(screen.getByRole('button', { name: '编辑 interest' }))
  await user.clear(screen.getByLabelText('中文义项'))
  await user.type(screen.getByLabelText('中文义项'), '第二次编辑的草稿')
  await act(async () => finish())
  expect(screen.getByRole('heading', { name: '编辑 interest' })).toBeInTheDocument()
  expect(screen.getByLabelText('中文义项')).toHaveValue('第二次编辑的草稿')
})
