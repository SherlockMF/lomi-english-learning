import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import type { LearningTrack, SessionTask, VocabularyItem } from '../domain/types'
import { speakWord } from '../lib/speech'
import { StudySession } from './StudySession'

vi.mock('../lib/speech', () => ({ speakWord: vi.fn().mockResolvedValue(undefined) }))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const item: VocabularyItem = {
  id: 'cash-flow-cash-movement',
  expression: 'cash flow',
  lemma: 'cash flow',
  senseKey: 'cash-movement',
  zhGloss: '现金流',
  enDefinition: 'money moving into and out of a business',
  partOfSpeech: 'noun phrase',
  acceptedZhAnswers: ['现金流量'],
  acceptedEnVariants: ['cashflow'],
  examples: [{ en: 'We monitor cash flow every week.', zh: '我们每周监控现金流。' }],
  collocations: ['positive cash flow', 'manage cash flow'],
  listSlugs: ['finance', 'accounting'],
  category: 'finance',
  source: 'seed',
  priority: 1,
  status: 'active',
  usagePrompts: [
    {
      id: 'cash-flow-cloze',
      type: 'cloze',
      prompt: 'We monitor _____ every week.',
      answer: 'cash flow',
      modelAnswer: 'We monitor cash flow every week.',
      checkpoints: ['cash flow'],
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const track: LearningTrack = {
  id: 'cash-flow-cash-movement:receptive',
  itemId: item.id,
  type: 'receptive',
  due: '2026-01-01T00:00:00.000Z',
  stability: 0,
  difficulty: 0,
  elapsedDays: 0,
  scheduledDays: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  unlocked: true,
}

const task: SessionTask = {
  id: 'task-1',
  itemId: item.id,
  trackId: track.id,
  trackType: 'receptive',
  isNew: true,
}

describe('StudySession', () => {
  it('looks up each revealed phrase word even when neither word is in the study library', async () => {
    const user = userEvent.setup()
    const phrase = { ...item, expression: 'payback period', zhGloss: '投资回收期' }
    const onRate = vi.fn()
    render(<StudySession initialTasks={[task]} items={[phrase]} tracks={[track]} mode="core"
      usableThisWeek={0} onRate={onRate} onExit={vi.fn()} onFinish={vi.fn()}
      evaluate={() => ({ rating: 'again', matched: false })} />)

    expect(screen.queryByRole('button', { name: '查词 payback' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '想不起来' }))
    const payback = await screen.findByRole('button', { name: '查词 payback' })
    await user.click(payback)
    const dialog = screen.getByRole('dialog', { name: 'payback' })
    expect(within(dialog).getByText(/投资回收；偿还/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '播放 payback 英式发音' })).toHaveTextContent('/ˈpeɪbæk/')
    await user.click(within(dialog).getByRole('button', { name: '播放 payback 美式发音' }))
    expect(speakWord).toHaveBeenLastCalledWith(expect.objectContaining({ expression: 'payback' }), 'us')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(payback).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '查词 period' }))
    expect(within(screen.getByRole('dialog', { name: 'period' })).getByText(/时期|期间|时段/)).toBeInTheDocument()
    expect(onRate).not.toHaveBeenCalled()
  })

  it('looks up a hyphenated word as a whole and preserves phrase punctuation', async () => {
    const user = userEvent.setup()
    const phrase = { ...item, expression: 'Wi-Fi password?' }
    render(<StudySession initialTasks={[task]} items={[phrase]} tracks={[track]} mode="core"
      usableThisWeek={0} onRate={vi.fn()} onExit={vi.fn()} onFinish={vi.fn()}
      evaluate={() => ({ rating: 'again', matched: false })} />)

    await user.click(screen.getByRole('button', { name: '想不起来' }))
    expect(screen.getByRole('heading', { name: 'Wi-Fi password?' })).toHaveTextContent('Wi-Fi password?')
    await user.click(screen.getByRole('button', { name: '查词 Wi-Fi' }))
    expect(within(screen.getByRole('dialog', { name: 'Wi-Fi' })).getByText(/无线网络/)).toBeInTheDocument()
  })

  it('locks background scrolling during training and restores it on unmount', () => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'auto'
    try {
      const { unmount } = render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core"
        usableThisWeek={0} onRate={vi.fn()} onExit={vi.fn()} onFinish={vi.fn()} evaluate={vi.fn()} />)
      expect(document.body.style.overflow).toBe('hidden')
      unmount()
      expect(document.body.style.overflow).toBe('auto')
    } finally {
      document.body.style.overflow = originalOverflow
    }
  })

  it('shows a sense-specific English context without revealing the Chinese gloss or marking a hint', async () => {
    const user = userEvent.setup()
    const evaluate = vi.fn().mockReturnValue({ rating: 'good', matched: true })
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core"
      usableThisWeek={0} onRate={vi.fn()} onExit={vi.fn()} onFinish={vi.fn()} evaluate={evaluate} />)
    expect(screen.getByText('We monitor cash flow every week.')).toBeInTheDocument()
    expect(screen.queryByText('现金流')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('你记得的中文意思'), '现金流')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    expect(evaluate.mock.calls[0][3]).toBe(0)
  })

  it('requires the current sense in a sentence task even for an older generic prompt', () => {
    const sentence = { ...item.usagePrompts[0], type: 'sentence' as const, prompt: '用 cash flow 写一句话' }
    render(<StudySession initialTasks={[{ ...task, trackType: 'usage' }]} items={[{ ...item, usagePrompts: [sentence] }]}
      tracks={[{ ...track, type: 'usage' }]} mode="extension" usableThisWeek={0}
      onRate={vi.fn()} onExit={vi.fn()} onFinish={vi.fn()} evaluate={vi.fn()} />)
    expect(screen.getByText('本题义项：现金流')).toBeInTheDocument()
  })
  it('replans pending words after a saved answer without restarting or repeating the answered question', async () => {
    const user = userEvent.setup()
    const next = { ...item, id: 'harder', expression: 'harder' }
    const nextTrack = { ...track, id: 'harder:receptive', itemId: next.id }
    const nextTask = { ...task, id: 'harder-task', trackId: nextTrack.id, itemId: next.id }
    const onRate = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn().mockImplementation(async () => { expect(onRate).toHaveBeenCalledOnce(); return [nextTask] })
    render(<StudySession initialTasks={[task]} items={[item, next]} tracks={[track, nextTrack]} mode="core"
      usableThisWeek={0} onRate={onRate} onRefreshTasks={refresh} onExit={vi.fn()} onFinish={vi.fn()}
      evaluate={() => ({ rating: 'good', matched: true })} />)
    await user.type(screen.getByLabelText('你记得的中文意思'), '现金流')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    await user.click(screen.getByRole('button', { name: /想起来了/ }))
    expect(refresh).toHaveBeenCalledWith([], new Set([item.id]), false)
    expect(screen.getByRole('heading', { name: 'harder' })).toBeInTheDocument()
    expect(onRate).toHaveBeenCalledOnce()
  })

  it('marks known without creating a review and fills the skipped fresh slot; update failure retries only the queue', async () => {
    const user = userEvent.setup()
    const next = { ...item, id: 'replacement', expression: 'replacement' }
    const nextTrack = { ...track, id: 'replacement:receptive', itemId: next.id }
    const nextTask = { ...task, id: 'replacement-task', trackId: nextTrack.id, itemId: next.id }
    const markKnown = vi.fn().mockResolvedValue(undefined)
    const onRate = vi.fn()
    const refresh = vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue([nextTask])
    render(<StudySession initialTasks={[task, { ...task, id: 'other-direction', trackType: 'productive' }]} items={[item, next]}
      tracks={[track, nextTrack]} mode="core" usableThisWeek={0} onRate={onRate} onMarkKnown={markKnown}
      onRefreshTasks={refresh} onExit={vi.fn()} onFinish={vi.fn()} evaluate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '这个词已会，跳过' }))
    expect(markKnown).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledWith([], new Set(), true)
    expect(onRate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '这个词已会，跳过' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '重试更新词汇' }))
    expect(screen.getByRole('heading', { name: 'replacement' })).toBeInTheDocument()
    expect(markKnown).toHaveBeenCalledOnce()
    expect(onRate).not.toHaveBeenCalled()
  })

  it('retries a priority word before advancing to the ordinary new words', async () => {
    const user = userEvent.setup()
    const priorityItem = { ...item, listSlugs: ['finance', 'my-vocabulary'] as VocabularyItem['listSlugs'] }
    const ordinaryItem = { ...item, id: 'ordinary', expression: 'ordinary' }
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<StudySession initialTasks={[task, { ...task, id: 'priority-2' },
      { ...task, id: 'ordinary-task', itemId: ordinaryItem.id }]} items={[priorityItem, ordinaryItem]}
      tracks={[track]} mode="core" usableThisWeek={0} onRate={onRate} onExit={vi.fn()} onFinish={vi.fn()}
      evaluate={() => ({ rating: 'good', matched: true })} />)
    await user.click(screen.getByRole('button', { name: '想不起来' }))
    await user.click(screen.getByRole('button', { name: /忘记了/ }))
    await user.type(screen.getByLabelText('你记得的中文意思'), '现金流')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    await user.click(screen.getByRole('button', { name: /想起来了/ }))
    expect(screen.getByRole('heading', { name: 'cash flow' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('你记得的中文意思'), '现金流')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    await user.click(screen.getByRole('button', { name: /想起来了/ }))
    expect(onRate.mock.calls[2][0]).toMatchObject({ itemId: item.id, retryCount: 1 })
    expect(screen.getByRole('heading', { name: 'ordinary' })).toBeInTheDocument()
  })

  it('requires free recall before revealing the target meaning', async () => {
    const user = userEvent.setup()
    const onRate = vi.fn().mockResolvedValue(undefined)

    render(
      <StudySession
        evaluate={(_task, _item, answer) => ({
          rating: answer === '现金流' ? 'good' : 'again',
          matched: answer === '现金流',
        })}
        initialTasks={[task]}
        items={[item]}
        mode="core"
        onExit={vi.fn()}
        onFinish={vi.fn()}
        onRate={onRate}
        tracks={[track]}
        usableThisWeek={0}
      />,
    )

    expect(screen.getByRole('heading', { name: 'cash flow' })).toBeInTheDocument()
    expect(screen.queryByText('现金流', { exact: true })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('你记得的中文意思'), '现金流')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))

    expect(screen.getAllByText('现金流', { exact: true }).length).toBeGreaterThan(0)
    expect(screen.getByText('We monitor cash flow every week.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /想起来了/ }))
    expect(onRate).toHaveBeenCalledWith(
      task,
      'good',
      expect.objectContaining({ answer: '现金流', hintLevel: 0 }),
    )
    expect(await screen.findByText('今天的记忆已经重新连上。')).toBeInTheDocument()
  })

  it('forces a revealed answer to be rated again', async () => {
    const user = userEvent.setup()
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(
      <StudySession
        evaluate={() => ({ rating: 'again', matched: false })}
        initialTasks={[task]}
        items={[item]}
        mode="core"
        onExit={vi.fn()}
        onFinish={vi.fn()}
        onRate={onRate}
        tracks={[track]}
        usableThisWeek={0}
      />,
    )

    await user.click(screen.getByRole('button', { name: '想不起来' }))
    expect(screen.getByRole('button', { name: /想起来了/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /忘记了/ }))
    expect(onRate).toHaveBeenCalledWith(
      task,
      'again',
      expect.objectContaining({ hintLevel: 0, evaluationSource: 'reveal', correctness: 'incorrect' }),
    )
  })

  it('waits for a saved result before advancing to the next card', async () => {
    const user = userEvent.setup()
    let resolveRate!: () => void
    const onRate = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveRate = resolve
    }))
    const secondTask: SessionTask = {
      ...task,
      id: 'task-2',
      trackId: 'track-2',
    }
    const secondTrack: LearningTrack = {
      ...track,
      id: 'track-2',
    }

    render(
      <StudySession
        evaluate={() => ({ rating: 'good', matched: true })}
        initialTasks={[task, secondTask]}
        items={[item]}
        mode="core"
        onExit={vi.fn()}
        onFinish={vi.fn()}
        onRate={onRate}
        tracks={[track, secondTrack]}
        usableThisWeek={0}
      />,
    )

    await user.type(screen.getByLabelText('你记得的中文意思'), '现金流')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    await user.click(screen.getByRole('button', { name: /想起来了/ }))

    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(onRate).toHaveBeenCalledTimes(1)
    await act(async () => resolveRate())
    expect(await screen.findByText('2 / 2')).toBeInTheDocument()
  })

  it('shows rules feedback immediately while a slow evaluate is still refining', async () => {
    const user = userEvent.setup()
    let resolveEvaluate!: (result: { rating: 'hard'; matched: true; feedbackZh: string }) => void
    const evaluate = vi.fn().mockImplementation((
      _task: SessionTask,
      _item: VocabularyItem,
      _answer: string,
      _hint: number,
      _revealed: boolean,
      _ms: number,
      options?: { onInterim?: (result: { rating: 'again'; matched: false }) => void },
    ) => {
      options?.onInterim?.({ rating: 'again', matched: false })
      return new Promise((resolve) => {
        resolveEvaluate = resolve
      })
    })

    render(
      <StudySession
        evaluate={evaluate}
        initialTasks={[task]}
        items={[item]}
        mode="core"
        onExit={vi.fn()}
        onFinish={vi.fn()}
        onRate={vi.fn()}
        tracks={[track]}
        usableThisWeek={0}
      />,
    )

    await user.type(screen.getByLabelText('你记得的中文意思'), '资金流动')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))

    expect(await screen.findByText('现在忘记很正常')).toBeInTheDocument()
    expect(screen.queryByText('判分中…')).not.toBeInTheDocument()

    resolveEvaluate({ rating: 'hard', matched: true, feedbackZh: '意思接近了。' })
    expect(await screen.findByText('意思接近了。')).toBeInTheDocument()
    expect(screen.getByText('接近了，再加固一次')).toBeInTheDocument()
  })

  it('keeps a failed save visible and retries it without clearing later cards', async () => {
    const user = userEvent.setup()
    let shouldFail = true
    const onRate = vi.fn().mockImplementation(async () => {
      if (shouldFail) throw new Error('disk full')
    })
    const secondTask: SessionTask = {
      ...task,
      id: 'task-2',
      trackId: 'track-2',
    }
    const secondTrack: LearningTrack = {
      ...track,
      id: 'track-2',
    }

    render(
      <StudySession
        evaluate={() => ({ rating: 'good', matched: true })}
        initialTasks={[task, secondTask]}
        items={[item]}
        mode="core"
        onExit={vi.fn()}
        onFinish={vi.fn()}
        onRate={onRate}
        tracks={[track, secondTrack]}
        usableThisWeek={0}
      />,
    )

    await user.type(screen.getByLabelText('你记得的中文意思'), '现金流')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    await user.click(screen.getByRole('button', { name: /想起来了/ }))

    expect(await screen.findByText(/1 条复习结果未保存/)).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    shouldFail = false
    await user.click(screen.getByRole('button', { name: '重试保存' }))
    expect(await screen.findByText('2 / 2')).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(screen.queryByText(/复习结果未保存/)).not.toBeInTheDocument()
    })
    expect(onRate).toHaveBeenCalledTimes(2)
    expect(onRate.mock.calls[0][2].attemptId).toBe(onRate.mock.calls[1][2].attemptId)
  })

  it('freezes answer time at submission and excludes grading waits from study time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T10:00:00'))
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let resolveGrade!: (value: { rating: 'good'; matched: true }) => void
    const onRate = vi.fn().mockResolvedValue(undefined)
    const onSaveTime = vi.fn().mockResolvedValue(undefined)
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} sessionId="s1" onSaveTime={onSaveTime} evaluate={() => new Promise((resolve) => { resolveGrade = resolve })} onRate={onRate} onExit={vi.fn()} onFinish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    fireEvent.click(screen.getByRole('button', { name: /提交回忆/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    await act(async () => resolveGrade({ rating: 'good', matched: true }))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /想起来了/ })))
    expect(onRate.mock.calls[0][2]).toMatchObject({ responseMs: 30_000, reviewedAt: new Date('2026-09-10T10:00:30').toISOString(), evidenceVersion: 1, sessionId: 's1', retryCount: 0 })
    expect(onSaveTime.mock.calls.at(-1)?.[0].activeMs).toBe(45_000)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['interim', 'local'] as const)('continues counting usable feedback after a batched %s evaluation', async (kind) => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const onRate = vi.fn().mockResolvedValue(undefined)
    const onSaveTime = vi.fn().mockResolvedValue(undefined)
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} onSaveTime={onSaveTime} evaluate={(_task, _item, _answer, _hint, _revealed, _responseMs, options) => {
      const result = { rating: 'good' as const, matched: true }
      if (kind === 'interim') {
        options?.onInterim?.(result)
        return new Promise(() => undefined)
      }
      return Promise.resolve(result)
    }} onRate={onRate} onExit={vi.fn()} onFinish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /提交回忆/ })))
    expect(screen.getByRole('button', { name: /想起来了/ })).toBeEnabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /想起来了/ })))
    expect(onRate.mock.calls[0][2].responseMs).toBe(30_000)
    expect(onSaveTime.mock.calls.at(-1)?.[0].activeMs).toBe(45_000)
  })

  it('keeps interim feedback paused while manually paused or unfocused', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const onSaveTime = vi.fn().mockResolvedValue(undefined)
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} onSaveTime={onSaveTime} evaluate={(_task, _item, _answer, _hint, _revealed, _responseMs, options) => {
      options?.onInterim?.({ rating: 'good', matched: true })
      return new Promise(() => undefined)
    }} onRate={vi.fn().mockResolvedValue(undefined)} onExit={vi.fn()} onFinish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /提交回忆/ })))
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    fireEvent.blur(window)
    fireEvent.click(screen.getByRole('button', { name: '恢复学习' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    fireEvent.focus(window)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /想起来了/ })))
    expect(onSaveTime.mock.calls.at(-1)?.[0].activeMs).toBe(2000)
  })

  it('ignores a late AI answer after the interim result has been saved', async () => {
    const user = userEvent.setup()
    let finishEvaluation!: (value: { rating: 'hard'; matched: true; feedbackZh: string }) => void
    const secondTask = { ...task, id: 'task-2' }
    render(<StudySession initialTasks={[task, secondTask]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} evaluate={(_task, _item, _answer, _hint, _reveal, _ms, options) => {
      options?.onInterim?.({ rating: 'again', matched: false, correctness: 'unverified' })
      return new Promise((resolve) => { finishEvaluation = resolve })
    }} onRate={vi.fn().mockResolvedValue(undefined)} onExit={vi.fn()} onFinish={vi.fn()} />)
    await user.type(screen.getByLabelText('你记得的中文意思'), '资金流动')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    await user.click(screen.getByRole('button', { name: /想起来了/ }))
    expect(await screen.findByText('2 / 2')).toBeInTheDocument()
    await act(async () => finishEvaluation({ rating: 'hard', matched: true, feedbackZh: '上一题的迟到反馈' }))
    expect(screen.queryByText('上一题的迟到反馈')).not.toBeInTheDocument()
    expect(screen.getByLabelText('你记得的中文意思')).toHaveValue('')
  })

  it('only requests sentence verification once and preserves the submitted answer', async () => {
    const user = userEvent.setup()
    const sentenceItem = { ...item, usagePrompts: [{ ...item.usagePrompts[0], type: 'sentence' as const }] }
    const sentenceTask = { ...task, trackType: 'usage' as const, promptIndex: 0 }
    const evaluate = vi.fn().mockResolvedValue({ rating: 'good', matched: true, source: 'rules', correctness: 'unverified', matchKind: 'checkpoint' })
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<StudySession initialTasks={[sentenceTask]} items={[sentenceItem]} tracks={[track]} mode="core" usableThisWeek={0} canVerifySentence evaluate={evaluate} onRate={onRate} onExit={vi.fn()} onFinish={vi.fn()} />)
    await user.type(screen.getByLabelText('你的句子'), 'We monitor cash flow.')
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('本次结果尚未验证')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '请 AI 验证本句' }))
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(evaluate.mock.calls[1][2]).toBe('We monitor cash flow.')
    expect(evaluate.mock.calls[1][6].verifySentence).toBe(true)
    expect(screen.getByRole('button', { name: '本次 AI 验证已请求' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /想起来了/ }))
    expect(onRate.mock.calls[0][2]).toMatchObject({ answer: 'We monitor cash flow.', promptId: 'cash-flow-cloze', correctness: 'unverified' })
  })

  it('keeps learning past fifteen minutes and completes only after the last task', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const onFinish = vi.fn()
    render(<StudySession initialTasks={[task, { ...task, id: 'task-2' }]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} evaluate={() => ({ rating: 'good', matched: true })} onRate={vi.fn().mockResolvedValue(undefined)} onExit={vi.fn()} onFinish={onFinish} />)
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    for (let minute = 0; minute < 16; minute += 1) {
      fireEvent.pointerDown(window)
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    }
    expect(screen.getByLabelText('本轮学习计时')).toHaveTextContent('16:00')
    expect(screen.getByLabelText('本轮学习计时')).not.toHaveTextContent('/')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /提交回忆/ })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /想起来了/ })))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(onFinish).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /提交回忆/ })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /想起来了/ })))
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it('keeps the known-word action inside the learning card', () => {
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0}
      onMarkKnown={vi.fn()} evaluate={vi.fn()} onRate={vi.fn()} onExit={vi.fn()} onFinish={vi.fn()} />)
    expect(screen.getByRole('button', { name: '这个词已会，跳过' }).closest('.recall-card')).not.toBeNull()
  })

  it('keeps an unsuccessful day rebuild retryable and never starts the old next card', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10, 23, 59, 59))
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const onDayChange = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<StudySession initialTasks={[task, { ...task, id: 'task-2' }]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} onDayChange={onDayChange} evaluate={() => ({ rating: 'good', matched: true })} onRate={onRate} onExit={vi.fn()} onFinish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /提交回忆/ })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /想起来了/ })))
    expect(screen.getByRole('alert')).toHaveTextContent('重新安排学习失败')
    expect(screen.queryByText('2 / 2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出训练' })).toBeEnabled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新安排今日学习' })))
    expect(onDayChange).toHaveBeenCalledTimes(2)
    expect(onRate).toHaveBeenCalledTimes(1)
  })

  it('can recover a failed exit checkpoint while an old grading request is pending', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let fail = true
    const onSaveTime = vi.fn().mockImplementation(async () => { if (fail) throw new Error('quota') })
    const onExit = vi.fn()
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} onSaveTime={onSaveTime} evaluate={() => new Promise(() => undefined)} onRate={vi.fn()} onExit={onExit} onFinish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /提交回忆/ })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '退出训练' })))
    fail = false
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试保存时间' })))
    expect(screen.getByRole('button', { name: /提交回忆/ })).toBeEnabled()
  })

  it('pauses on a time checkpoint failure and retains time for retry', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const onSaveTime = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined)
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} onSaveTime={onSaveTime} evaluate={() => ({ rating: 'good', matched: true })} onRate={vi.fn()} onExit={vi.fn()} onFinish={vi.fn()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByRole('alert')).toHaveTextContent('学习时间未保存，已暂停')
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试保存时间' })))
    expect(onSaveTime.mock.calls.at(-1)?.[0].activeMs).toBe(5000)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not resume blocked grading time when the manual pause is toggled', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let resolveGrade!: (result: { rating: 'good'; matched: true }) => void
    const onSaveTime = vi.fn().mockResolvedValue(undefined)
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} onSaveTime={onSaveTime} evaluate={() => new Promise((resolve) => { resolveGrade = resolve })} onRate={vi.fn().mockResolvedValue(undefined)} onExit={vi.fn()} onFinish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    fireEvent.click(screen.getByRole('button', { name: /提交回忆/ }))
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复学习' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    await act(async () => resolveGrade({ rating: 'good', matched: true }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /想起来了/ })))
    expect(onSaveTime.mock.calls.at(-1)?.[0].activeMs).toBe(1000)
  })

  it('blocks submitting until a requested hint is available', async () => {
    const user = userEvent.setup()
    let resolveHint!: (hint: string) => void
    const evaluate = vi.fn().mockResolvedValue({ rating: 'hard', matched: true })
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<StudySession initialTasks={[task]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} resolveHint={() => new Promise((resolve) => { resolveHint = resolve })} evaluate={evaluate} onRate={onRate} onExit={vi.fn()} onFinish={vi.fn()} />)
    await user.type(screen.getByLabelText('你记得的中文意思'), '现金流')
    await user.click(screen.getByRole('button', { name: '给一点提示' }))
    expect(screen.getByRole('button', { name: /提交回忆/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '想不起来' })).toBeDisabled()
    await act(async () => resolveHint('资金的流入和流出'))
    await user.click(screen.getByRole('button', { name: /提交回忆/ }))
    expect(evaluate.mock.calls[0][3]).toBe(1)
    await user.click(screen.getByRole('button', { name: /有点模糊/ }))
    expect(onRate.mock.calls[0][2].hintLevel).toBe(1)
  })

  it('splits an overnight session and rebuilds the plan after saving the current answer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10, 23, 59, 50))
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const onSaveTime = vi.fn().mockResolvedValue(undefined)
    const onDayChange = vi.fn()
    render(<StudySession initialTasks={[task, { ...task, id: 'task-2' }]} items={[item]} tracks={[track]} mode="core" usableThisWeek={0} onDayChange={onDayChange} onSaveTime={onSaveTime} evaluate={() => ({ rating: 'good', matched: true })} onRate={vi.fn().mockResolvedValue(undefined)} onExit={vi.fn()} onFinish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('你记得的中文意思'), { target: { value: '现金流' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /提交回忆/ })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /想起来了/ })))
    expect(onDayChange).toHaveBeenCalledTimes(1)
    const finalByDay = new Map(onSaveTime.mock.calls.map(([entry]) => [entry.localDate, entry.activeMs]))
    expect(finalByDay.get('2026-09-10')).toBe(10_000)
    expect(finalByDay.get('2026-09-11')).toBe(10_000)
  })

  it('blocks answering while usage prompts are still being generated', async () => {
    let resolveEnsure!: (item: VocabularyItem) => void
    const ensureUsageItem = vi.fn().mockImplementation(() => new Promise<VocabularyItem>((resolve) => {
      resolveEnsure = resolve
    }))
    const usageTask: SessionTask = {
      id: 'task-usage',
      itemId: item.id,
      trackId: `${item.id}:usage`,
      trackType: 'usage',
      isNew: false,
      promptIndex: 0,
    }
    const usageTrack: LearningTrack = {
      ...track,
      id: `${item.id}:usage`,
      type: 'usage',
    }
    const sparseItem: VocabularyItem = {
      ...item,
      usagePrompts: [],
    }

    render(
      <StudySession
        ensureUsageItem={ensureUsageItem}
        evaluate={() => ({ rating: 'good', matched: true })}
        initialTasks={[usageTask]}
        items={[sparseItem]}
        mode="extension"
        onExit={vi.fn()}
        onFinish={vi.fn()}
        onRate={vi.fn()}
        tracks={[usageTrack]}
        usableThisWeek={0}
      />,
    )

    expect(await screen.findByText('正在生成使用题…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /准备题目/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '想不起来' })).toBeDisabled()

    resolveEnsure({
      ...sparseItem,
      usagePrompts: item.usagePrompts,
    })
    expect(await screen.findByRole('button', { name: '想不起来' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /提交回忆/ })).toBeDisabled()
  })
})
