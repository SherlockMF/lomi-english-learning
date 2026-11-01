import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoicePractice } from './VoicePractice'
import { EMPTY_VOICE_SNAPSHOT, VoiceSession } from '../lib/voice/session'
import type { VoiceTurn } from '../lib/voice/transcript'
import { chatJson } from '../lib/llm/client'
import { clearDeepseekApiKey, setDeepseekApiKey } from '../lib/llm/config'
import { clearVoiceHistory, listVoiceHistory, readVoiceHistory } from '../lib/voice/history'

vi.mock('../lib/llm/client', () => ({ chatJson: vi.fn() }))

vi.mock('../lib/voice/session', async (original) => {
  const actual = await original<typeof import('../lib/voice/session')>()
  return { ...actual, VoiceSession: vi.fn(function (this: Record<string, unknown>, options: { onChange: (state: unknown) => void }) {
    this.start = vi.fn(async () => options.onChange({ ...actual.EMPTY_VOICE_SNAPSHOT, phase: 'ready' }))
    this.end = vi.fn(() => options.onChange({ ...actual.EMPTY_VOICE_SNAPSHOT, phase: 'ended', notice: '本次对话已结束。' }))
    this.setMuted = vi.fn()
    this.pause = vi.fn(() => options.onChange({ ...actual.EMPTY_VOICE_SNAPSHOT, phase: 'paused', elapsedSeconds: 15 }))
    this.resume = vi.fn(async () => options.onChange({ ...actual.EMPTY_VOICE_SNAPSHOT, phase: 'ready', elapsedSeconds: 15 }))
    this.requestHelp = vi.fn()
  }) }
})

afterEach(async () => { cleanup(); await clearVoiceHistory(); clearDeepseekApiKey(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.mocked(chatJson).mockReset() })

const spoken = (id: string, text: string, role: VoiceTurn['role'] = 'user'): VoiceTurn => ({ id, text, role, final: true, interrupted: false })
const grammarCorrection = { original: 'I goes to work.', improved: 'I go to work.', explanationZh: '主语 I 后用动词原形 go。' }

async function startLivePractice(configured = true, strict = false) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ configured: true, model: 'qwen3.8-omni-flash-realtime', maxSeconds: null }))))
  if (configured) setDeepseekApiKey('test-only-placeholder')
  const user = userEvent.setup()
  const view = render(strict ? <StrictMode><VoicePractice items={[]} accent="uk" /></StrictMode> : <VoicePractice items={[]} accent="uk" />)
  await user.click(screen.getByRole('button', { name: /实时畅聊/ }))
  await screen.findByText('千问语音已配置')
  await user.click(screen.getByRole('button', { name: '开始对话' }))
  return { ...view, user, emit: (turns: VoiceTurn[]) => act(() => {
    vi.mocked(VoiceSession).mock.calls.at(-1)![0].onChange({ ...EMPTY_VOICE_SNAPSHOT, phase: 'ready', turns })
  }) }
}

describe('live voice corrections', () => {
  it('saves live subtitles and corrections and restores them for review without another AI request', async () => {
    vi.mocked(chatJson).mockResolvedValue({ corrections: [grammarCorrection] })
    const { emit, unmount, user } = await startLivePractice()
    emit([spoken('u1', grammarCorrection.original)])
    await screen.findByText(grammarCorrection.improved)
    await waitFor(async () => {
      const records = await listVoiceHistory()
      expect(records).toHaveLength(1)
      expect((await readVoiceHistory(records[0].id))?.corrections.u1).toEqual([grammarCorrection])
    })
    unmount()
    render(<VoicePractice items={[]} accent="uk" />)
    await user.click(await screen.findByRole('button', { name: /回看练习/ }))
    expect((await screen.findAllByText(grammarCorrection.original)).length).toBeGreaterThan(0)
    expect(screen.getByText(grammarCorrection.improved)).toBeInTheDocument()
    expect(chatJson).toHaveBeenCalledTimes(1)
  })
  it('keeps delayed feedback visible at the bottom without interrupting history reading', async () => {
    let resize!: () => void
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect = disconnect
    })
    vi.mocked(chatJson).mockReturnValue(new Promise(() => {}))
    const { emit, unmount } = await startLivePractice()
    emit([spoken('u1', grammarCorrection.original)])
    const transcript = screen.getByRole('log', { name: '对话字幕' })
    let height = 500
    Object.defineProperties(transcript, {
      clientHeight: { value: 340 }, scrollHeight: { get: () => height },
    })
    expect(resize).toBeTypeOf('function')
    act(() => resize())
    transcript.scrollTop = 160
    fireEvent.scroll(transcript)
    height = 760
    act(() => resize())
    expect(transcript.scrollTop).toBe(760)
    transcript.scrollTop = 50
    fireEvent.scroll(transcript)
    height = 900
    act(() => resize())
    expect(transcript.scrollTop).toBe(50)
    height = 1039
    act(() => resize())
    transcript.scrollTop = 549
    fireEvent.scroll(transcript)
    // Native scroll anchoring moves the viewport when an earlier bubble grows.
    height = 1299
    transcript.scrollTop = 809
    act(() => resize())
    expect(transcript.scrollTop).toBe(809)
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('does not send duplicate checks in StrictMode', async () => {
    vi.mocked(chatJson).mockResolvedValue({ corrections: [] })
    const { emit } = await startLivePractice(true, true)
    emit([spoken('u1', 'Hello.')])
    await screen.findByText('未发现明显语法或用词问题')
    expect(chatJson).toHaveBeenCalledTimes(1)
  })

  it('checks only finalized learner speech and displays corrections beside it while the conversation continues', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(chatJson).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { emit } = await startLivePractice()
    const question = spoken('a1', 'What do you do every morning?', 'assistant')
    const learner = spoken('u1', grammarCorrection.original)
    emit([question, { ...learner, final: false }])
    expect(chatJson).not.toHaveBeenCalled()
    emit([question, learner])
    expect(screen.getByText('正在检查表达…')).toBeInTheDocument()
    await waitFor(() => expect(chatJson).toHaveBeenCalledTimes(1))
    emit([question, learner, spoken('a2', 'Where do you work?', 'assistant')])
    expect(screen.getByText('Where do you work?')).toBeInTheDocument()
    expect(chatJson).toHaveBeenCalledTimes(1)
    await act(async () => finish({ corrections: [grammarCorrection] }))
    const bubble = screen.getByText(grammarCorrection.original).closest('.voice-turn') as HTMLElement
    expect(within(bubble).getByText(grammarCorrection.improved)).toBeInTheDocument()
    expect(within(bubble).getByText(grammarCorrection.explanationZh)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '结束对话' })).toBeEnabled()
    const data = JSON.parse(vi.mocked(chatJson).mock.calls[0][0].messages[1].content)
    expect(data).toEqual({ learnerSpeech: learner.text, previousReply: question.text })
  })

  it('accepts no clear error without manufacturing a correction', async () => {
    vi.mocked(chatJson).mockResolvedValue({ corrections: [] })
    const { emit } = await startLivePractice()
    emit([spoken('u1', 'I worked today.')])
    expect(await screen.findByText('未发现明显语法或用词问题')).toBeInTheDocument()
    expect(screen.queryByText('建议改为')).not.toBeInTheDocument()
  })

  it('keeps failed checks local to the sentence and retries only on request', async () => {
    vi.mocked(chatJson).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ corrections: [grammarCorrection] })
    const { emit, user } = await startLivePractice()
    const turns = [spoken('u1', grammarCorrection.original)]
    emit(turns)
    await screen.findByText('本句检查失败')
    emit([...turns, spoken('a1', 'Tell me more.', 'assistant')])
    expect(chatJson).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '结束对话' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '重试本句纠错' }))
    expect(await screen.findByText(grammarCorrection.improved)).toBeInTheDocument()
    expect(chatJson).toHaveBeenCalledTimes(2)
  })

  it('attaches out-of-order results to the right utterance', async () => {
    const finishes: ((value: unknown) => void)[] = []
    vi.mocked(chatJson).mockImplementation(() => new Promise((resolve) => { finishes.push(resolve) }))
    const { emit } = await startLivePractice()
    emit([spoken('u1', grammarCorrection.original), spoken('u2', 'She work here.')])
    await waitFor(() => expect(chatJson).toHaveBeenCalledTimes(2))
    await act(async () => finishes[1]({ corrections: [{ original: 'She work here.', improved: 'She works here.', explanationZh: '第三人称单数用 works。' }] }))
    await act(async () => finishes[0]({ corrections: [grammarCorrection] }))
    expect(within(screen.getByText('She work here.').closest('.voice-turn') as HTMLElement).getByText('She works here.')).toBeInTheDocument()
    expect(within(screen.getByText(grammarCorrection.original).closest('.voice-turn') as HTMLElement).getByText(grammarCorrection.improved)).toBeInTheDocument()
  })

  it('cancels a pending check on restart and ignores its late result', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(chatJson).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { emit, user } = await startLivePractice()
    emit([spoken('u1', grammarCorrection.original)])
    await waitFor(() => expect(chatJson).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(chatJson).mock.calls[0][0].signal
    await user.click(screen.getByRole('button', { name: '结束对话' }))
    await user.click(screen.getByRole('button', { name: '重新开始对话' }))
    expect(signal?.aborted).toBe(true)
    await act(async () => finish({ corrections: [grammarCorrection] }))
    expect(screen.queryByText(grammarCorrection.improved)).not.toBeInTheDocument()
  })

  it('cancels a pending check when leaving the page', async () => {
    vi.mocked(chatJson).mockReturnValue(new Promise(() => {}))
    const { emit, unmount } = await startLivePractice()
    emit([spoken('u1', grammarCorrection.original)])
    await waitFor(() => expect(chatJson).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(chatJson).mock.calls[0][0].signal
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('does not send speech when DeepSeek is not configured', async () => {
    const { emit } = await startLivePractice(false)
    emit([spoken('u1', grammarCorrection.original)])
    expect(chatJson).not.toHaveBeenCalled()
    expect(screen.getByText(/配置 DeepSeek 后可自动逐句纠错/)).toBeInTheDocument()
  })

  it('does not check interrupted or empty turns', async () => {
    const { emit } = await startLivePractice()
    emit([{ ...spoken('u1', grammarCorrection.original), interrupted: true }, spoken('u2', ' '), spoken('a1', 'Hello.', 'assistant')])
    await waitFor(() => expect(screen.getByText('Hello.')).toBeInTheDocument())
    expect(chatJson).not.toHaveBeenCalled()
  })
})

describe('VoicePractice', () => {
  it('offers pause and resume without starting another practice or allowing preparation edits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true, model: 'qwen3.8-omni-flash-realtime', maxSeconds: null }))))
    const user = userEvent.setup()
    render(<VoicePractice items={[]} accent="uk" />)
    await user.click(screen.getByRole('button', { name: /实时畅聊/ }))
    await screen.findByText('千问语音已配置')
    await user.click(screen.getByRole('button', { name: '开始对话' }))
    await user.click(screen.getByRole('button', { name: '暂停对话' }))
    expect(screen.getByText('对话已暂停，麦克风已关闭')).toBeInTheDocument()
    expect(screen.getByLabelText('已练习 15 秒')).toHaveTextContent('0:15')
    expect(screen.getByRole('button', { name: '中文解释' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: /场景说明/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '切换模式' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '继续对话' }))
    expect(screen.getByRole('button', { name: '暂停对话' })).toBeEnabled()
    expect(VoiceSession).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '暂停对话' }))
    await user.click(screen.getByRole('button', { name: '结束对话' }))
    expect(screen.getByRole('button', { name: '重新开始对话' })).toBeEnabled()
  })
  it('explains missing server configuration without requesting microphone permission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: false, model: 'qwen3.8-omni-flash-realtime', maxSeconds: null }))))
    render(<VoicePractice items={[]} accent="uk" />)
    await userEvent.click(screen.getByRole('button', { name: /实时畅聊/ }))
    expect(await screen.findByText(/语音服务尚未配置/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始对话/ })).toBeDisabled()
    expect(VoiceSession).not.toHaveBeenCalled()
  })

  it('offers all scenarios and releases the call when navigating away', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true, model: 'qwen3.8-omni-flash-realtime', maxSeconds: null }))))
    const user = userEvent.setup()
    const view = render(<VoicePractice items={[]} accent="us" />)
    await user.click(screen.getByRole('button', { name: /实时畅聊/ }))
    await screen.findByText('千问语音已配置')
    await user.click(screen.getByRole('button', { name: /商务沟通/ }))
    await user.type(screen.getByRole('textbox', { name: /场景说明/ }), '与客户协商交货日期')
    await user.click(screen.getByRole('button', { name: /开始对话/ }))
    expect(VoiceSession).toHaveBeenCalledWith(expect.objectContaining({ scenario: 'business', accent: 'us', scenarioDescription: '与客户协商交货日期' }))
    expect(screen.getByRole('textbox', { name: /场景说明/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '结束对话' })).toBeInTheDocument()
    const call = vi.mocked(VoiceSession).mock.instances[0]
    view.unmount()
    expect(call.end).toHaveBeenCalledTimes(1)
  })

  it('chooses a mode without opening the microphone and preserves preparation when switching', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true }))))
    const user = userEvent.setup()
    render(<VoicePractice items={[]} accent="uk" />)
    expect(screen.getByRole('button', { name: /实时畅聊/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /语音消息/ })).toBeInTheDocument()
    expect(VoiceSession).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /实时畅聊/ }))
    await user.click(screen.getByRole('button', { name: /商务沟通/ }))
    await user.type(screen.getByRole('textbox', { name: /场景说明/ }), '介绍我的创业想法')
    await user.selectOptions(screen.getByRole('combobox'), 'advanced')
    await user.click(screen.getByRole('button', { name: '切换模式' }))
    await user.click(screen.getByRole('button', { name: /语音消息/ }))
    expect(screen.getByRole('button', { name: /商务沟通/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('combobox')).toHaveValue('advanced')
    expect(screen.getByRole('textbox', { name: /场景说明/ })).toHaveValue('介绍我的创业想法')
    expect(VoiceSession).not.toHaveBeenCalled()
  })

  it('keeps a separate description for each category and permits an empty custom scene', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true, model: 'qwen3.8-omni-flash-realtime', maxSeconds: null }))))
    const user = userEvent.setup()
    render(<VoicePractice items={[]} accent="uk" />)
    await user.click(screen.getByRole('button', { name: /实时畅聊/ }))
    expect(screen.getByText(/例如：点餐、问路、购物/)).toBeInTheDocument()
    const field = screen.getByRole('textbox', { name: /场景说明/ })
    expect(field).toHaveAttribute('maxlength', '500')
    await user.type(field, '我在机场问路')
    await user.click(screen.getByRole('button', { name: /自定义/ }))
    expect(field).toHaveValue('')
    await user.type(field, '聊我喜欢的科幻电影')
    await user.click(screen.getByRole('button', { name: /日常生活/ }))
    expect(field).toHaveValue('我在机场问路')
    await user.click(screen.getByRole('button', { name: /自定义/ }))
    expect(field).toHaveValue('聊我喜欢的科幻电影')
    await user.clear(field)
    await screen.findByText('千问语音已配置')
    await user.click(screen.getByRole('button', { name: /开始对话/ }))
    expect(VoiceSession).toHaveBeenCalledWith(expect.objectContaining({ scenario: 'custom', scenarioDescription: '' }))
  })
})
