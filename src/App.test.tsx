import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'
import App from './App'
import { clearDatabase, closeDatabase, getUserDataSnapshot, initializeDatabase, putSettings, putStudyTimeEntry, writeBatch } from './lib/db'
import { DEFAULT_SETTINGS, type ReviewAttempt } from './domain/types'
import { handcraftedSeedWords, loadSeedPack } from './data/seedVocabulary'
import * as seedVocabulary from './data/seedVocabulary'
import { LIST_IDS } from './data/vocabularyLists'
import * as dictionary from './lib/dictionary'
import * as dictionarySenses from './data/dictionarySenses'
import { DICTIONARY_CONTENT_REVISION } from './data/dictionaryContentRevision'
import { gradeAttempt } from './lib/grading'
import { createInitialTracks } from './lib/scheduler'

describe('App integration', () => {
  beforeEach(async () => {
    await clearDatabase()
    vi.spyOn(dictionarySenses, 'loadBundledDictionarySenses').mockResolvedValue({ revision: DICTIONARY_CONTENT_REVISION, results: [] })
  })

  afterEach(async () => {
    cleanup()
    await closeDatabase()
    vi.restoreAllMocks()
  })

  it('keeps a returning account on its installed vocabulary until it saves an expansion choice', async () => {
    const oldSettings = { ...DEFAULT_SETTINGS, seedContentRevision: '5.3.2', dictionaryContentRevision: DICTIONARY_CONTENT_REVISION, activeCategories: ['daily'] as const }
    const original = handcraftedSeedWords[0]
    const housing = { ...handcraftedSeedWords[1], id: 'v6-housing-test' }
    const math = { ...handcraftedSeedWords[2], id: 'v6-math-test' }
    await initializeDatabase([original], [], undefined, { ...oldSettings, activeCategories: [...oldSettings.activeCategories] })
    const before = await getUserDataSnapshot()
    const load = vi.spyOn(seedVocabulary, 'loadSeedPack').mockResolvedValue({
      words: [original, housing, math],
      memberships: [{ id: 'housing-test', wordId: housing.id, listId: LIST_IDS.housing, priority: 1, sortOrder: 0 },
        { id: 'math-test', wordId: math.id, listId: LIST_IDS.math, priority: 1, sortOrder: 0 }],
    })
    const user = userEvent.setup()
    const view = render(<App preserveVocabulary />)
    const notice = await screen.findByRole('region', { name: '词库已更新' })
    expect(await getUserDataSnapshot()).toEqual(before)
    expect(load).not.toHaveBeenCalled()
    await user.click(within(notice).getByRole('button', { name: '知道了' }))
    await waitFor(() => expect(notice).not.toBeInTheDocument())
    view.unmount()
    render(<App preserveVocabulary initialTab="library" />)
    await user.click(await screen.findByRole('button', { name: '管理学习词库' }))
    expect(screen.queryByRole('region', { name: '词库已更新' })).not.toBeInTheDocument()
    const editor = screen.getByRole('region', { name: '学习词库' })
    await user.click(within(editor).getByRole('checkbox', { name: '住宿生活' }))
    await user.click(within(editor).getByRole('button', { name: '保存学习词库' }))
    await waitFor(async () => {
      const after = await getUserDataSnapshot()
      expect(after.words.map(word => word.id)).toEqual([original.id, housing.id])
      expect(after.settings.activeCategories).toEqual(['daily', 'housing'])
      expect(after.settings.expansionCategories).toEqual(['daily', 'housing'])
      expect(after.tracks.filter(track => track.itemId === original.id)).toEqual(before.tracks)
    })
  })

  it('restores opted-in expansion words without resetting reviews synced from another device', async () => {
    const settings = { ...DEFAULT_SETTINGS, seedContentRevision: '5.3.2', dictionaryContentRevision: DICTIONARY_CONTENT_REVISION }
    const original = handcraftedSeedWords[0]
    const housing = { ...handcraftedSeedWords[1], id: 'v6-housing-test' }
    const reviewed = { ...createInitialTracks([housing])[0], reps: 5, stability: 15 }
    await initializeDatabase([original], [], undefined, settings)
    vi.spyOn(seedVocabulary, 'loadSeedPack').mockResolvedValue({
      words: [original, housing],
      memberships: [{ id: 'housing-test', wordId: housing.id, listId: LIST_IDS.housing, priority: 1, sortOrder: 0 }],
    })
    render(<App preserveVocabulary />)
    await screen.findByRole('heading', { name: '今日学习计划' })
    await writeBatch({ settings: { ...settings, activeCategories: ['housing'], expansionCategories: ['housing'] }, tracks: [reviewed] })
    act(() => window.dispatchEvent(new Event('recall-cloud-data-applied')))
    await waitFor(async () => {
      const after = await getUserDataSnapshot()
      expect(after.words.map(word => word.id)).toEqual([original.id, housing.id])
      expect(after.tracks.find(track => track.id === reviewed.id)).toEqual(reviewed)
    })
  })

  it('offers a first-open picker, starts from the chosen list, and persists library changes', async () => {
    const words = handcraftedSeedWords.slice(0, 3).map((word, index) => ({ ...word,
      expression: `category-flow-${index}`, lemma: `category-flow-${index}`, vocabularyLevel: 'B1' as const,
    }))
    await initializeDatabase(words, words.map((word, i) => ({ id: `category-flow-${i}`, wordId: word.id,
      listId: [LIST_IDS.daily, LIST_IDS.cs, LIST_IDS.math][i], priority: word.priority, sortOrder: 0,
    })))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('checkbox', { name: '计算机科学' }, { timeout: 10_000 }))
    await user.click(screen.getByRole('button', { name: '开始第一课' }))
    expect(await screen.findByRole('heading', { name: 'category-flow-1' }, { timeout: 10_000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '退出训练' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '退出训练' })).not.toBeInTheDocument())
    const initial = await getUserDataSnapshot()
    expect(initial.settings.activeCategories).toEqual(['cs'])
    expect(initial.settings.learningGoal).toBe('cs')

    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    await user.click(await screen.findByRole('button', { name: '管理学习词库' }, { timeout: 10_000 }))
    const editor = screen.getByRole('region', { name: '学习词库' })
    await user.click(within(editor).getByRole('checkbox', { name: '数学' }))
    await user.click(within(editor).getByRole('checkbox', { name: '日常生活' }))
    await user.click(within(editor).getByRole('button', { name: '上移数学' }))
    await user.click(within(editor).getByRole('checkbox', { name: '计算机科学' }))
    await user.click(within(editor).getByRole('button', { name: '保存学习词库' }))
    await waitFor(async () => {
      const saved = await getUserDataSnapshot()
      expect(saved.settings.activeCategories).toEqual(['math', 'daily'])
      expect(saved.settings.learningGoal).toBe('math')
      expect(saved.words).toEqual(initial.words)
      expect(saved.tracks).toEqual(initial.tracks)
    })
  }, 30_000)

  it('lets guests inspect proposed plans without signing in or changing learning data', async () => {
    await initializeDatabase([handcraftedSeedWords[0]])
    const before = await getUserDataSnapshot()
    const onRequestLogin = vi.fn()
    const user = userEvent.setup()
    render(<App onRequestLogin={onRequestLogin} />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '套餐' })[0])
    const plans = await screen.findByRole('region', { name: '给每天的英语，留一点时间。' })
    expect(within(plans).getByText(/暂未开放购买/)).toBeInTheDocument()
    expect(within(plans).getByRole('article', { name: '标准' })).toHaveTextContent('69')
    expect(within(plans).getByRole('article', { name: '标准' })).toHaveTextContent('推荐')
    expect(within(plans).queryByRole('button', { name: /购买|开通|订阅|升级/ })).not.toBeInTheDocument()
    await user.click(within(plans).getByRole('button', { name: '去口语页看看' }))
    expect(await screen.findByRole('heading', { name: '把学过的英语，说出来。' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '练习历史' })).not.toBeInTheDocument()
    expect(onRequestLogin).not.toHaveBeenCalled()
    expect(await getUserDataSnapshot()).toEqual(before)
  })

  it('previews pages without reading local user data and gates actual actions', async () => {
    const privateWord = { ...handcraftedSeedWords[0], id: 'private-word', expression: 'private-account-word' }
    await initializeDatabase([privateWord])
    const before = await getUserDataSnapshot()
    const onRequestLogin = vi.fn()
    const lookup = vi.spyOn(dictionary, 'lookupDictionary')
    const user = userEvent.setup()
    render(<App onRequestLogin={onRequestLogin} />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getByRole('button', { name: '开始今天的训练' }))
    expect(onRequestLogin).toHaveBeenCalledTimes(1)
    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    const search = await screen.findByRole('textbox', { name: '搜索词库' })
    await user.type(search, privateWord.expression)
    expect(screen.queryByRole('button', { name: `查看 ${privateWord.expression} 的详情` })).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, handcraftedSeedWords[0].expression)
    await user.click(screen.getByRole('button', { name: `查看 ${handcraftedSeedWords[0].expression} 的详情` }))
    expect(onRequestLogin).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /^设为已会 / }))
    expect(onRequestLogin).toHaveBeenCalledTimes(2)
    await user.click(screen.getAllByRole('button', { name: '添加' })[0])
    await user.type(await screen.findByLabelText('先查一个英文单词'), 'example')
    await user.keyboard('{Enter}')
    expect(onRequestLogin).toHaveBeenCalledTimes(3)
    expect(lookup).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '加入 42 个工作表达' }))
    expect(onRequestLogin).toHaveBeenCalledTimes(4)
    await user.click(screen.getAllByRole('button', { name: '口语' })[0])
    await user.click(await screen.findByRole('button', { name: /实时畅聊/ }))
    expect(onRequestLogin).toHaveBeenCalledTimes(4)
    await user.click(screen.getByRole('button', { name: '开始对话' }))
    expect(onRequestLogin).toHaveBeenCalledTimes(5)
    await user.click(screen.getByRole('button', { name: '切换模式' }))
    await user.click(screen.getByRole('button', { name: /语音消息/ }))
    await user.click(screen.getByRole('button', { name: '开始语音消息练习' }))
    expect(onRequestLogin).toHaveBeenCalledTimes(6)
    await user.click(screen.getByRole('button', { name: '打开设置' }))
    await screen.findByRole('dialog', { name: '学习设置' })
    expect(onRequestLogin).toHaveBeenCalledTimes(6)
    await user.click(screen.getByRole('button', { name: '保存设置' }))
    expect(onRequestLogin).toHaveBeenCalledTimes(7)
    expect(await getUserDataSnapshot()).toEqual(before)
  }, 120_000)

  it('expires a delayed recall sample during the same day on the next clock tick', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const now = new Date(2026, 9, 22, 12)
    vi.setSystemTime(now)
    try {
      const word = handcraftedSeedWords[0]
      await initializeDatabase([word])
      const track = (await getUserDataSnapshot()).tracks.find(value => value.itemId === word.id && value.type === 'productive')!
      const attempt = (id: string, at: number): ReviewAttempt => ({ id, itemId: word.id, trackId: track.id,
        trackType: 'productive', promptType: 'productive', answer: word.expression, rating: 'good', hintLevel: 0,
        responseMs: 3000, reviewedAt: new Date(at).toISOString(), evidenceVersion: 1, sessionId: 'clock-boundary',
        retryCount: 0, evaluationSource: 'rules', correctness: 'correct', matchKind: 'exact', suggestedRating: 'good' })
      await writeBatch({ attempts: [attempt('previous', now.getTime() - 9 * 86_400_000),
        attempt('boundary', now.getTime() - 7 * 86_400_000 + 30_000)] })
      render(<App />)
      expect(await screen.findByText('近 7 天延迟回忆正确率：1 / 1 次。即时重试与自评不计入。')).toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(60_000) })
      expect(screen.getByText('近 7 天延迟回忆正确率：0 / 0 次。即时重试与自评不计入。')).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })

  it('removes a corrected gloss from grading while preserving independent answers and learning history', async () => {
    const original = { ...handcraftedSeedWords[0], id: 'edit-regression-word', expression: 'edit-regression',
      lemma: 'edit-regression', zhGloss: '旧误译', acceptedZhAnswers: ['旧误译', ' 旧误译。 ', '独立同义答案'] }
    await initializeDatabase([original], [{ id: 'edit-regression-membership', wordId: original.id,
      listId: LIST_IDS.daily, priority: original.priority, sortOrder: 0 }])
    const before = await getUserDataSnapshot()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    await user.type(await screen.findByRole('textbox', { name: '搜索词库' }), original.expression)
    await user.click(screen.getByRole('button', { name: `查看 ${original.expression} 的详情` }))
    await user.click(screen.getByRole('button', { name: `编辑 ${original.expression}` }))
    await user.clear(screen.getByLabelText('中文义项'))
    await user.type(screen.getByLabelText('中文义项'), '修正后的释义')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    await screen.findByRole('button', { name: '关闭词条详情' })
    const after = await getUserDataSnapshot()
    const edited = after.vocabulary.find((item) => item.id === original.id)!
    expect(edited.acceptedZhAnswers).toEqual(['修正后的释义', '独立同义答案'])
    expect(gradeAttempt({ item: edited, trackType: 'receptive', answer: '旧误译' }).correct).toBe(false)
    expect(gradeAttempt({ item: edited, trackType: 'receptive', answer: '独立同义答案' }).correct).toBe(true)
    expect(edited).toMatchObject({ contentEdited: true })
    expect(after.tracks.filter((track) => track.itemId === original.id)).toEqual(before.tracks)
    expect(after.attempts).toEqual(before.attempts)
  }, 120_000)

  it('keeps the existing library usable when supplemental content fails and can retry later', async () => {
    await initializeDatabase()
    await writeBatch({ words: [handcraftedSeedWords[0]] })
    vi.mocked(dictionarySenses.loadBundledDictionarySenses).mockRejectedValueOnce(new Error('补全资源不可用'))
      .mockResolvedValue({ revision: DICTIONARY_CONTENT_REVISION, results: [] })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    const retry = await screen.findByRole('button', { name: '重试词义补全' })
    expect((await getUserDataSnapshot()).settings.dictionaryContentRevision).not.toBe(DICTIONARY_CONTENT_REVISION)
    await user.click(retry)
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试词义补全' })).not.toBeInTheDocument())
    expect((await getUserDataSnapshot()).settings.dictionaryContentRevision).toBe(DICTIONARY_CONTENT_REVISION)
  }, 120_000)

  it('keeps spaces and punctuation significant when caching and deduplicating batch expressions', async () => {
    const expressions = ['work out', 'workout', 're-sign', 'resign']
    const lookup = vi.spyOn(dictionary, 'lookupDictionary').mockImplementation(async (query) => ({
      query, word: query, fetchedAt: '2026-10-13T00:00:00Z',
      meanings: [{ partOfSpeech: 'expression', zhGloss: `测试义项 ${query}`, definition: `meaning of ${query}`, synonyms: [] }],
    }))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '添加' })[0])
    await user.click(await screen.findByRole('button', { name: '批量粘贴' }))
    await user.type(screen.getByLabelText('批量词汇'), expressions.join('\n') + '\n WORK OUT ')
    await user.click(screen.getByRole('button', { name: '补全并加入队列' }))
    await screen.findByText(/失败 0 条/, {}, { timeout: 10_000 })
    expect(lookup.mock.calls.map(([query]) => query)).toEqual(expressions)
    const after = await getUserDataSnapshot()
    for (const expression of expressions) expect(after.words.filter((word) => word.expression === expression && word.source === 'dictionary'))
      .toEqual([expect.objectContaining({ zhGloss: `测试义项 ${expression}`, status: 'active' })])
  }, 120_000)

  it('writes edited content from the add form into an existing sense and leaves unedited senses intact', async () => {
    const source = { query: 'edit-probe', word: 'edit-probe', fetchedAt: '2026-10-13T00:00:00Z', meanings: [
      { partOfSpeech: 'noun', zhGloss: '原义项', definition: 'original definition', example: 'Original example.', synonyms: [] },
      { partOfSpeech: 'noun', zhGloss: '未编辑义项', definition: 'untouched definition', synonyms: [] },
    ] }
    const { saveDictionarySenses } = await import('./lib/wordSenses')
    await initializeDatabase()
    await saveDictionarySenses(source, [0], 'auto')
    vi.spyOn(dictionary, 'lookupDictionary').mockResolvedValue(source)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    const before = await getUserDataSnapshot()
    await user.click(screen.getAllByRole('button', { name: '添加' })[0])
    await user.type(screen.getByLabelText('先查一个英文单词'), source.word)
    await user.click(screen.getByRole('button', { name: '词典辅助' }))
    await user.clear(screen.getByLabelText('中文义项（可选）'))
    await user.type(screen.getByLabelText('中文义项（可选）'), '修正义项')
    await user.clear(screen.getByLabelText('英文例句'))
    await user.type(screen.getByLabelText('英文例句'), 'Edited example.')
    await user.click(screen.getByRole('button', { name: /未编辑义项 untouched definition/ }))
    await user.click(screen.getByRole('button', { name: /保存全部词义/ }))
    await screen.findByText(/已保存 “edit-probe” 的词义/)
    const after = await getUserDataSnapshot()
    const original = before.words.find((word) => word.zhGloss === '原义项')!
    expect(after.words.find((word) => word.id === original.id)).toMatchObject({ zhGloss: '修正义项', examples: [{ en: 'Edited example.', zh: '' }] })
    const untouched = before.words.find((word) => word.zhGloss === '未编辑义项')!
    expect(after.words.find((word) => word.id === untouched.id)).toEqual(untouched)
    expect(after.tracks).toEqual(before.tracks)
  }, 120_000)

  it('imports multiple senses with distinct automatic categories and retains only failed English rows', async () => {
    const lookup = vi.spyOn(dictionary, 'lookupDictionary').mockImplementation(async (query) => {
      if (query === 'missing-import-probe') throw new Error('词典离线')
      if (query === 'import-bank-probe') return { query, word: query, fetchedAt: '2026-10-11T00:00:00Z', meanings: [] }
      return { query, word: query, fetchedAt: '2026-10-11T00:00:00Z', meanings: [
        { partOfSpeech: 'noun', zhGloss: '兴趣', definition: 'a desire to learn', synonyms: [] },
        { partOfSpeech: 'noun', zhGloss: '利息', definition: 'money paid for a loan', synonyms: [] },
      ] }
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    const before = await getUserDataSnapshot()
    await user.click(screen.getAllByRole('button', { name: '添加' })[0])
    await user.click(await screen.findByRole('button', { name: '批量粘贴' }))
    await user.type(screen.getByLabelText('批量词汇'), 'import-interest-probe | 兴趣\nimport-interest-probe | 利息\nmissing-import-probe\nimport-bank-probe,银行,noun,finance,a financial institution\nimport-bank-probe,银行,noun,finance,a building housing a financial institution')
    await user.click(screen.getByRole('button', { name: '补全并加入队列' }))
    await screen.findByText(/失败 1 条/, {}, { timeout: 10_000 })
    const after = await getUserDataSnapshot()
    const added = after.vocabulary.filter((word) => word.expression === 'import-interest-probe')
    expect(added).toHaveLength(2)
    expect(added.every((word) => word.status === 'active' && word.listSlugs.includes('my-vocabulary'))).toBe(true)
    expect(added.find((word) => word.zhGloss === '兴趣')?.category).toBe('daily')
    expect(added.find((word) => word.zhGloss === '利息')?.category).toBe('finance')
    expect(screen.getByLabelText('批量词汇')).toHaveValue('missing-import-probe')
    expect(lookup).toHaveBeenCalledTimes(3)
    const bankSenses = after.words.filter((word) => word.expression === 'import-bank-probe')
    expect(bankSenses).toHaveLength(2)
    expect(new Set(bankSenses.map((word) => word.senseKey)).size).toBe(2)
    expect(bankSenses.every((word) => word.status === 'active')).toBe(true)
    expect(after.attempts).toEqual(before.attempts)
    expect(after.tracks.filter((track) => before.tracks.some((old) => old.id === track.id))).toEqual(before.tracks)
  }, 120_000)

  it('retries failed imports with fresh slower lookups while preserving saved senses and study progress', async () => {
    let retrying = false
    const lookup = vi.spyOn(dictionary, 'lookupDictionary').mockImplementation(async (query) => {
      if (!retrying && query !== 'retry-wallet-probe') throw new Error('词典查询超时')
      return { query, word: query, fetchedAt: '2026-10-27T00:00:00Z', meanings: [{
        partOfSpeech: 'noun', zhGloss: query === 'retry-ratio-probe' ? '比例' : '释义',
        definition: 'a dictionary definition', synonyms: [], senseKey: `dictionary:youdao:${query}:0`,
      }] }
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '添加' })[0])
    await user.click(await screen.findByRole('button', { name: '批量粘贴' }))
    await user.type(screen.getByLabelText('批量词汇'), 'retry-ratio-probe,比例,noun,finance\nretry-ratio-probe,比例,noun,finance\nretry-competitor-probe\nretry-wallet-probe')
    await user.click(screen.getByRole('button', { name: '补全并加入队列' }))
    await screen.findByRole('button', { name: '重试失败词条（2）' }, { timeout: 10_000 })
    const before = await getUserDataSnapshot()
    const ratio = before.words.find((word) => word.expression === 'retry-ratio-probe')!
    const tracks = before.tracks.filter((track) => track.itemId === ratio.id).map((track) => ({ ...track, reps: 7 }))
    await writeBatch({ words: [{ ...ratio, status: 'paused', knownAt: '2026-10-27T00:00:00Z' }], tracks })
    retrying = true
    lookup.mockClear()
    await user.click(screen.getByRole('button', { name: '重试失败词条（2）' }))
    await screen.findByText(/本次重试完成/, {}, { timeout: 10_000 })
    expect(lookup).toHaveBeenCalledTimes(2)
    for (const query of ['retry-ratio-probe', 'retry-competitor-probe']) {
      expect(lookup).toHaveBeenCalledWith(query, { forceRefresh: true, timeoutMs: 15_000 })
    }
    const after = await getUserDataSnapshot()
    const ratios = after.words.filter((word) => word.expression === ratio.expression)
    expect(ratios).toHaveLength(1)
    expect(ratios[0]).toMatchObject({ id: ratio.id, status: 'paused', knownAt: '2026-10-27T00:00:00Z', enDefinition: 'a dictionary definition' })
    expect(after.tracks.filter((track) => track.itemId === ratio.id)).toEqual(tracks)
    expect(after.memberships.filter((membership) => membership.wordId === ratio.id)).toEqual(before.memberships.filter((membership) => membership.wordId === ratio.id))
    expect(screen.queryByRole('button', { name: /重试失败词条/ })).not.toBeInTheDocument()
  }, 120_000)

  it('loads supplemental senses at startup and keeps existing training state on subsequent boots', async () => {
    await initializeDatabase()
    const word = { ...handcraftedSeedWords[0], id: 'supplemental-probe', expression: 'supplemental-probe',
      senseKey: 'custom:old', zhGloss: '原有义项', partOfSpeech: 'noun', status: 'paused' as const,
      source: 'custom' as const, knownAt: '2026-10-11T00:00:00Z' }
    await writeBatch({ words: [word], memberships: [{ id: 'probe-daily', wordId: word.id,
      listId: LIST_IDS.daily, priority: 0, sortOrder: 0 }] })
    vi.mocked(dictionarySenses.loadBundledDictionarySenses).mockResolvedValue({ revision: DICTIONARY_CONTENT_REVISION, results: [{
      query: word.expression, word: word.expression, fetchedAt: '2026-10-11T00:00:00Z', meanings: [
        { zhGloss: '原有义项', partOfSpeech: 'noun', definition: 'original', synonyms: [] },
        { zhGloss: '新增义项', partOfSpeech: 'verb', definition: 'another sense', synonyms: [] },
      ],
    }] })
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    const after = await getUserDataSnapshot()
    expect(after.words.find((item) => item.id === word.id)).toEqual(word)
    expect(after.words.find((item) => item.zhGloss === '新增义项')?.status).toBe('paused')
    expect(after.settings.dictionaryContentRevision).toBe(DICTIONARY_CONTENT_REVISION)
    cleanup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    expect(dictionarySenses.loadBundledDictionarySenses).toHaveBeenCalledTimes(1)
    expect((await getUserDataSnapshot()).words).toEqual(after.words)
  }, 120_000)

  it('keeps custom scenario membership and progress when completing its senses', async () => {
    await initializeDatabase()
    const word = { ...handcraftedSeedWords[0], id: 'custom-scenario', expression: 'scenario-probe', source: 'custom' as const,
      zhGloss: '原有义项', partOfSpeech: 'noun', senseKey: 'custom:original', usagePrompts: [] }
    await writeBatch({ words: [word], memberships: [{ id: 'custom-membership', wordId: word.id,
      listId: LIST_IDS['my-vocabulary'], priority: 0, sortOrder: 0, subcategory: '宿舍交流' }] })
    vi.spyOn(dictionary, 'lookupDictionary').mockResolvedValue({ query: word.expression, word: word.expression,
      fetchedAt: '2026-10-11T00:00:00Z', meanings: [{ partOfSpeech: 'verb', zhGloss: '补充义项',
        definition: 'a distinct sense', synonyms: [] }] })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    const before = await getUserDataSnapshot()
    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    await user.type(await screen.findByLabelText('搜索词库'), word.expression)
    await user.click(screen.getByRole('button', { name: `查看 ${word.expression} 的详情` }))
    await user.click(screen.getByRole('button', { name: `补全词义 ${word.expression}` }))
    await screen.findByText(/已保存 “scenario-probe” 的词义/, {}, { timeout: 10_000 })
    const after = await getUserDataSnapshot()
    expect(after.vocabulary.filter((item) => item.expression === word.expression)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: word.id, listSlugs: ['my-vocabulary'], scenarioNote: '宿舍交流' }),
      expect.objectContaining({ zhGloss: '补充义项', listSlugs: ['my-vocabulary'], scenarioNote: '宿舍交流', status: 'paused' }),
    ]))
    expect(after.words.find((item) => item.id === word.id)).toEqual(before.words.find((item) => item.id === word.id))
    expect(after.tracks.filter((track) => track.itemId === word.id)).toEqual(before.tracks.filter((track) => track.itemId === word.id))
  }, 120_000)

  it('saves all senses, restores the grouped entry and preserves existing progress on completion', async () => {
    const user = userEvent.setup()
    const lookup = vi.spyOn(dictionary, 'lookupDictionary').mockResolvedValue({
      query: 'interest', word: 'interest', fetchedAt: '2026-10-08T00:00:00.000Z',
      meanings: [
        { zhGloss: '兴趣', partOfSpeech: 'noun', definition: 'a desire to learn about something', synonyms: [] },
        { zhGloss: '利息', partOfSpeech: 'noun', definition: 'money paid for borrowing money', synonyms: [] },
        { partOfSpeech: 'verb', definition: 'to attract attention', synonyms: [] },
      ],
    })
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    const before = await getUserDataSnapshot()
    const oldSense = before.words.find((word) => word.expression === 'interest')!
    await user.click(screen.getAllByRole('button', { name: '添加' })[0])
    await user.type(screen.getByLabelText('先查一个英文单词'), 'interest')
    await user.click(screen.getByRole('button', { name: '词典辅助' }))
    await user.click(screen.getByRole('button', { name: /保存全部词义/ }))
    await screen.findByText(/已保存 “interest” 的词义/, {}, { timeout: 10_000 })
    const saved = await getUserDataSnapshot()
    expect(saved.words.find((word) => word.id === oldSense.id)).toEqual(oldSense)
    expect(saved.words.find((word) => word.expression === 'interest' && word.zhGloss === '兴趣')?.status).toBe('active')
    expect(saved.words.find((word) => word.expression === 'interest' && !word.zhGloss)?.status).toBe('paused')
    cleanup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    await user.type(await screen.findByLabelText('搜索词库'), 'interest')
    expect(screen.getAllByRole('heading', { name: 'interest' })).toHaveLength(1)
    const card = screen.getByRole('heading', { name: 'interest' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: '查看 interest 的详情' }))
    await user.click(screen.getByRole('button', { name: /^选择义项 \d+：to attract attention$/ }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '恢复 interest：to attract attention' })).toBeDisabled()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '补全词义 interest' }))
    await screen.findByText(/新增 0 个/, {}, { timeout: 10_000 })
    const completed = await getUserDataSnapshot()
    expect(completed.words).toEqual(saved.words)
    expect(completed.tracks).toEqual(saved.tracks)
    expect(lookup).toHaveBeenCalledTimes(2)
  }, 120_000)

  it('seeds the local library and starts a no-choice recall session', async () => {
    const user = userEvent.setup()
    render(<StrictMode><App /></StrictMode>)

    expect(await screen.findByText('今日学习计划', {}, { timeout: 20_000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '暂时关闭' }))
    await user.click(screen.getByText('查看长期进度与统计依据'))
    expect(screen.getByText('表达积累')).toBeInTheDocument()
    expect(screen.getByText('日常生活')).toBeInTheDocument()
    expect(screen.getByText('商业英语')).toBeInTheDocument()
    expect(screen.getByText('金融会计')).toBeInTheDocument()
    expect(await screen.findByText('0 / 5115', {}, { timeout: 60_000 })).toBeInTheDocument()
    expect(await screen.findByText('0 / 3374', {}, { timeout: 60_000 })).toBeInTheDocument()
    expect(await screen.findByText('0 / 3907', {}, { timeout: 60_000 })).toBeInTheDocument()
    expect(await screen.findByLabelText('学习进度：已开始 0，双向可回忆 0，词库 12387', {}, { timeout: 60_000 })).toBeInTheDocument()
    expect(screen.getByText('学习进度')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /开始今天的训练/ }))
    expect(await screen.findByRole('button', { name: '想不起来' })).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  }, 120_000)

  it('opens all four primary sections including voice practice', async () => {
    const user = userEvent.setup()
    render(<StrictMode><App /></StrictMode>)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })

    const addButtons = screen.getAllByRole('button', { name: '添加' })
    await user.click(addButtons[0])
    expect(await screen.findByText('把今天遇到的词，变成明天能想起的表达。')).toBeInTheDocument()

    const libraryButtons = screen.getAllByRole('button', { name: '词库' })
    await user.click(libraryButtons[0])
    expect(await screen.findByRole('heading', { name: '词库' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('37462')).toBeInTheDocument(), { timeout: 20_000 })

    await user.click(screen.getAllByRole('button', { name: '口语' })[0])
    expect(await screen.findByText('把学过的英语，说出来。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /语音消息/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /实时畅聊/ }))
    expect(screen.getByRole('button', { name: /开始对话/ })).toBeDisabled()
  }, 120_000)

  it('adds and removes a library word from priority study without deleting its data', async () => {
    const { words, memberships } = await loadSeedPack()
    const seedWord = words.find((word) => word.expression === 'abandon')!
    await initializeDatabase([seedWord], memberships.filter((item) => item.wordId === seedWord.id))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    await user.type(await screen.findByRole('textbox', { name: '搜索词库' }), 'abandon')
    const card = screen.getByRole('heading', { name: 'abandon' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: '查看 abandon 的详情' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '加入优先学习 abandon' }))
    await screen.findByText('已加入优先学习：abandon')
    await user.click(screen.getByRole('button', { name: '关闭词条详情' }))
    await user.click(screen.getByRole('button', { name: '优先学习' }))
    const before = await getUserDataSnapshot()
    const item = before.vocabulary.find((word) => word.expression === 'abandon')!
    await user.click(screen.getByRole('button', { name: '查看 abandon 的详情' }))
    await user.click(screen.getByRole('button', { name: '移除优先学习 abandon' }))
    await screen.findByText('已移除优先学习：abandon')
    await user.click(screen.getByRole('button', { name: '关闭词条详情' }))
    expect(screen.queryByRole('heading', { name: 'abandon' })).not.toBeInTheDocument()
    const after = await getUserDataSnapshot()
    expect(after.vocabulary.find((word) => word.id === item.id)?.listSlugs).toEqual(['daily'])
    expect(after.words).toEqual(before.words)
    expect(after.tracks).toEqual(before.tracks)
    expect(after.attempts).toEqual(before.attempts)
    cleanup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    await user.type(await screen.findByRole('textbox', { name: '搜索词库' }), 'abandon')
    await user.click(screen.getByRole('button', { name: '查看 abandon 的详情' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '加入优先学习 abandon' })).toBeInTheDocument()
  }, 120_000)

  it('persists and reverses known marks without creating evidence, with difficulty filtering and editing', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    await user.type(await screen.findByRole('textbox', { name: '搜索词库' }), 'abandon')
    const before = await getUserDataSnapshot()
    const id = before.vocabulary.find((word) => word.expression === 'abandon')!.id
    await user.click(screen.getByRole('button', { name: '查看 abandon 的详情' }))
    await user.click(screen.getByRole('button', { name: '设为已会 abandon' }))
    await screen.findByText('已设为已会：abandon')
    const marked = await getUserDataSnapshot()
    expect(marked.words.find((word) => word.id === id)?.knownAt).toBeTruthy()
    expect(marked.attempts).toEqual(before.attempts)
    expect(marked.tracks).toEqual(before.tracks)
    cleanup(); render(<App />)
    await screen.findByText('今日学习计划', {}, { timeout: 20_000 })
    await user.click(screen.getAllByRole('button', { name: '词库' })[0])
    await user.type(await screen.findByRole('textbox', { name: '搜索词库' }), 'abandon')
    await user.selectOptions(screen.getByLabelText('筛选学习状态'), 'known')
    expect(screen.getByRole('heading', { name: 'abandon' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('筛选词汇难度'), 'C2')
    expect(screen.queryByRole('heading', { name: 'abandon' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('筛选词汇难度'), 'all')
    await user.click(screen.getByRole('button', { name: '查看 abandon 的详情' }))
    await user.click(screen.getByRole('button', { name: '撤销已会 abandon' }))
    await screen.findByText('已恢复学习：abandon')
    expect((await getUserDataSnapshot()).words.find((word) => word.id === id)?.knownAt).toBeUndefined()
    await user.click(screen.getByRole('button', { name: '关闭词条详情' }))
    await user.selectOptions(screen.getByLabelText('筛选学习状态'), 'all')
    const card = screen.getByRole('heading', { name: 'abandon' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: '查看 abandon 的详情' }))
    await user.click(screen.getByRole('button', { name: '编辑 abandon' }))
    await user.selectOptions(within(screen.getByRole('dialog')).getByLabelText('词汇难度'), 'C2')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    await screen.findByRole('button', { name: '关闭词条详情' })
    await user.click(screen.getByRole('button', { name: '关闭词条详情' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await getUserDataSnapshot()).words.find((word) => word.id === id)?.vocabularyLevel).toBe('C2')
  }, 120_000)

  it('uses saved time from both kinds of practice in one displayed and executable daily plan', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    await putSettings({ ...DEFAULT_SETTINGS, dailyMinutes: 20, newItemsPerDay: 2 })
    for (const [sessionId, activeMs] of [['core', 480_000], ['application', 420_000]] as const) {
      await putStudyTimeEntry({ id: `${sessionId}:${localDate}`, sessionId, localDate, activeMs, updatedAt: now.toISOString() })
    }
    render(<StrictMode><App /></StrictMode>)
    expect(await screen.findByText('今日学习计划', {}, { timeout: 20_000 })).toBeInTheDocument()
    expect(screen.getByText('今日已学习 15 分钟 · 按自己的节奏完成')).toBeInTheDocument()
    expect(screen.getByLabelText('预计 3 分钟，共 4 道练习')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /开始今天的训练/ }))
    expect(await screen.findByRole('button', { name: '想不起来' })).toBeInTheDocument()
  }, 120_000)

  it.each([0, 1, 6])('offers another round only when new expressions remain (%i available)', async (remaining) => {
    const user = userEvent.setup()
    const words = Array.from({ length: remaining + 1 }, (_, index) => ({
      ...handcraftedSeedWords[0], id: `extra-study-${index}`, expression: `study-${index}`,
      lemma: `study-${index}`, zhGloss: '学习', usagePrompts: [],
    }))
    const memberships = words.map((word, index) => ({
      id: `extra-study-membership-${index}`, wordId: word.id, listId: LIST_IDS['my-vocabulary'],
      priority: 1, sortOrder: index,
    }))
    const pausedSeedWords = handcraftedSeedWords.map((word) => ({ ...word, status: 'paused' as const }))
    await initializeDatabase([...pausedSeedWords, ...words], memberships, undefined, { ...DEFAULT_SETTINGS, newItemsPerDay: 1 })
    render(<App />)

    async function finishExpression(expression: string) {
      for (const answer of ['学习', expression]) {
        await user.type(await screen.findByRole('textbox'), answer)
        await user.click(screen.getByRole('button', { name: '提交回忆' }))
        await user.click(await screen.findByRole('button', { name: /想起来了.*正常间隔/ }))
      }
    }

    await user.click(await screen.findByRole('button', { name: '开始今天的训练' }))
    await finishExpression('study-0')
    expect(await screen.findByRole('heading', { name: '今天的学习计划已完成' })).toBeInTheDocument()
    if (remaining > 0) {
      expect(screen.getByText('要不要再学一小组新表达？')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '再学一组' })).toBeEnabled()
      if (remaining > 1) await user.click(screen.getByRole('button', { name: '今天先到这里' }))
      await user.click(await screen.findByRole('button', { name: '再学一组' }))
      expect(await screen.findByText('继续学习', { exact: true })).toBeInTheDocument()
      expect(screen.getByText(`1 / ${Math.min(5, remaining) * 2}`)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'study-1' })).toBeInTheDocument()
      if (remaining === 1) {
        await finishExpression('study-1')
        expect(await screen.findByRole('heading', { name: '今天的学习计划已完成' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: '再学一组' })).not.toBeInTheDocument()
        const { attempts } = await getUserDataSnapshot()
        expect(attempts.filter((attempt) => attempt.itemId === words[1].id)).toHaveLength(2)
        expect(new Set(attempts.map((attempt) => attempt.sessionId)).size).toBe(2)
      }
    } else {
      expect(screen.queryByRole('button', { name: '再学一组' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '回到今天' }))
      expect(screen.getByText('今天的学习计划已完成。')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '再学一组' })).not.toBeInTheDocument()
    }
    expect((await getUserDataSnapshot()).settings.newItemsPerDay).toBe(1)
  }, 120_000)
})
