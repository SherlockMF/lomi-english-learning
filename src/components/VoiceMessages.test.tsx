import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceMessages } from './VoiceMessages'
import { DEFAULT_VOICE_SELECTION } from './VoicePreparation'
import { VoiceMessageError } from '../lib/voice/messages'
import type { VocabularyItem } from '../domain/types'
import { Blob as NodeBlob } from 'node:buffer'
import { clearVoiceHistory, listVoiceHistory, readVoiceHistory } from '../lib/voice/history'
import { VoicePractice } from './VoicePractice'

const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), end: vi.fn(), record: vi.fn(), finish: vi.fn(), cancel: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }))
vi.mock('../lib/voice/config', () => ({ useVoiceConfig: () => ({ config: { configured: true }, error: '', reload: vi.fn() }) }))
vi.mock('../lib/voice/messages', async (original) => {
  const actual = await original<typeof import('../lib/voice/messages')>()
  return { ...actual, VoiceMessageSession: class { start = mocks.start; send = mocks.send; end = mocks.end } }
})
vi.mock('../lib/voice/audio', async (original) => {
  const actual = await original<typeof import('../lib/voice/audio')>()
  return { ...actual, VoiceRecorder: class { start = mocks.record; finish = mocks.finish; cancel = mocks.cancel } }
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.start.mockResolvedValue(undefined); mocks.record.mockResolvedValue(undefined)
  mocks.finish.mockResolvedValue(new Uint8Array(32000))
  mocks.send.mockImplementation(async (id) => ({ id, userText: 'A coffee, please.', text: 'Of course.', audio: 'AAAAAA==', usage: {}, sampleRate: 24000 }))
  mocks.createUrl.mockImplementation(() => `blob:test-${mocks.createUrl.mock.calls.length}`)
  vi.stubGlobal('URL', class extends URL { static createObjectURL = mocks.createUrl; static revokeObjectURL = mocks.revokeUrl })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
})
afterEach(async () => { cleanup(); await clearVoiceHistory(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function open() {
  const view = render(<VoiceMessages items={[]} accent="uk" selection={DEFAULT_VOICE_SELECTION} onSelection={vi.fn()} onBack={vi.fn()} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '开始语音消息练习' }))
  await user.click(screen.getByRole('button', { name: '改为点击录音' }))
  return { user, view }
}
async function record(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '点击开始录音' }))
  await user.click(await screen.findByRole('button', { name: '结束录音并发送' }))
}
describe('VoiceMessages', () => {
  it('persists both audio messages and restores playback after remount', async () => {
    vi.stubGlobal('Blob', NodeBlob)
    const { user, view } = await open()
    await record(user)
    await waitFor(async () => {
      const records = await listVoiceHistory()
      expect(records).toHaveLength(1)
      const saved = await readVoiceHistory(records[0].id)
      expect(saved?.turns).toHaveLength(2)
      expect(saved?.turns.every(turn => turn.audio && turn.audio.size > 0)).toBe(true)
    })
    view.unmount()
    render(<VoicePractice items={[]} accent="uk" />)
    await user.click(await screen.findByRole('button', { name: /回看练习/ }))
    expect(await screen.findByRole('button', { name: /播放你的/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /播放AI 的/ })).toBeEnabled()
    expect(screen.getByText('A coffee, please.')).toBeInTheDocument()
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('keeps recording available after ten minutes and displays elapsed time', async () => {
    const { user } = await open()
    // Advance the wall clock while leaving user interactions on real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 600_000)
    await waitFor(() => expect(screen.getByLabelText('已练习 600 秒')).toHaveTextContent('10:00'))
    expect(mocks.end).not.toHaveBeenCalled()
    await record(user)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('keeps the scene when reconnecting and bounds Chinese history to the gateway body limit', async () => {
    const items: VocabularyItem[] = [0, 1, 2].map((id) => ({
      id: `word-${id}`, expression: `word ${id}`, lemma: 'word', senseKey: `test-${id}`, zhGloss: '词义'.repeat(100), enDefinition: '', partOfSpeech: 'noun',
      acceptedZhAnswers: [], acceptedEnVariants: [], examples: [], collocations: [], source: 'custom', priority: 1, status: 'active', usagePrompts: [],
      createdAt: '', updatedAt: '', listSlugs: ['daily'], category: 'daily',
    }))
    const description = '酒店场景'.repeat(125)
    render(<VoiceMessages items={items} accent="uk" selection={{ ...DEFAULT_VOICE_SELECTION, descriptions: { daily: description }, selectedIds: items.map(({ id }) => id) }} onSelection={vi.fn()} onBack={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '开始语音消息练习' }))
    await user.click(screen.getByRole('button', { name: '改为点击录音' }))
    mocks.send.mockImplementation(async (id) => ({ id, userText: '我'.repeat(250), text: '你'.repeat(250), audio: 'AAAAAA==', usage: {}, sampleRate: 24000 }))
    for (let turn = 0; turn < 3; turn++) await record(user)
    mocks.send.mockRejectedValueOnce(new VoiceMessageError('Session ended.', true))
    await record(user)
    await user.click(await screen.findByRole('button', { name: '重试发送' }))
    const instructions = mocks.start.mock.calls[1]?.[0]
    expect(instructions).toContain(description)
    expect(new TextEncoder().encode(JSON.stringify({ instructions })).length).toBeLessThanOrEqual(8192)
  })
  it('starts the message model with the chosen custom scene and no coffee shop role', async () => {
    render(<VoiceMessages items={[]} accent="uk" selection={{ ...DEFAULT_VOICE_SELECTION, scenario: 'custom', descriptions: { custom: '聊聊科幻电影' } }} onSelection={vi.fn()} onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '开始语音消息练习' }))
    expect(mocks.start.mock.calls[0]?.[0]).toContain('聊聊科幻电影')
    expect(mocks.start.mock.calls[0]?.[0]).not.toContain('barista')
    expect(screen.getByRole('textbox', { name: /场景说明/ })).toBeDisabled()
  })
  it('honours cancellation while the audio worklet is flushing the last chunk', async () => {
    const { user } = await open()
    let flush: (value: Uint8Array<ArrayBuffer>) => void = () => undefined
    mocks.finish.mockImplementationOnce(() => new Promise((resolve) => { flush = resolve }))
    await user.click(screen.getByRole('button', { name: '点击开始录音' }))
    await user.click(screen.getByRole('button', { name: '结束录音并发送' }))
    await user.click(screen.getByRole('button', { name: '取消录音' }))
    await act(async () => flush(new Uint8Array(32000)))
    expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '点击开始录音' })).toBeEnabled()
  })
  it('sends a recorded message, provides replay and transcription, retains audio after ending and clears it on exit', async () => {
    const { user, view } = await open()
    expect(mocks.record).not.toHaveBeenCalled()
    await record(user)
    expect(await screen.findByRole('button', { name: /播放你的 1 秒语音/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /播放AI 的 1 秒语音/ })).toBeEnabled()
    expect(screen.getByText('A coffee, please.')).toBeInTheDocument()
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '生成本次练习反馈' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '结束练习' }))
    expect(mocks.end).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /播放你的/ })).toBeEnabled()
    expect(mocks.revokeUrl).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '生成本次练习反馈' })).toBeEnabled()
    view.unmount()
    expect(mocks.revokeUrl).toHaveBeenCalledTimes(2)
  })
  it('cancels locally without sending any audio and stops a pending permission request on end', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: '点击开始录音' }))
    await user.click(screen.getByRole('button', { name: '取消录音' }))
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    expect(mocks.finish).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    mocks.record.mockImplementation(() => new Promise(() => undefined))
    await user.click(screen.getByRole('button', { name: '点击开始录音' }))
    await user.click(screen.getByRole('button', { name: '结束练习' }))
    expect(mocks.cancel).toHaveBeenCalledTimes(2)
    expect(screen.getByText('麦克风已关闭')).toBeInTheDocument()
  })
  it('retains failed audio and retries the identical message without recording or reconnecting', async () => {
    const { user } = await open()
    mocks.send.mockRejectedValueOnce(new Error('Network failed.'))
    await record(user)
    await user.click(await screen.findByRole('button', { name: '重试发送' }))
    await screen.findByText('Of course.')
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[0])
    expect(mocks.record).toHaveBeenCalledTimes(1)
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })
  it('reconnects only on explicit retry after a server session has ended, preserving the recording', async () => {
    const { user } = await open()
    mocks.send.mockRejectedValueOnce(new VoiceMessageError('Session ended.', true))
    await record(user)
    await screen.findByText(/重试会建立新的练习会话/)
    expect(mocks.start).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '重试发送' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2))
    expect(mocks.start).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[0])
    expect(mocks.revokeUrl).not.toHaveBeenCalled()
  })
})
