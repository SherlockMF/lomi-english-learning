import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { VoiceHistory } from './VoiceHistory'
import { createVoiceHistoryWriter, clearVoiceHistory, listVoiceHistory } from '../lib/voice/history'
import { clearDatabase, closeDatabase, getDatabase, selectDatabaseAccount } from '../lib/db'
import { VOICE_HISTORY_APPLIED } from '../lib/voice/historyCloudStorage'
const audioDownload = vi.hoisted(() => vi.fn())
vi.mock('../lib/voice/historyTransport', () => ({ downloadVoiceHistoryAudio: audioDownload }))

afterEach(async () => { cleanup(); await clearDatabase(); await selectDatabaseAccount(null); await closeDatabase(); vi.restoreAllMocks(); vi.unstubAllGlobals(); audioDownload.mockReset() })
async function seed(description: string) {
  const writer = createVoiceHistoryWriter({ mode: 'realtime', scenario: 'daily', description, difficulty: 'basic' })
  await writer.update({ turns: [{ id: 'u1', role: 'user', text: description, final: true, interrupted: false }] })
  return writer
}
it('requires confirmation to delete one session or clear all, and remains deleted after reopening', async () => {
  await seed('第一场练习'); await seed('第二场练习')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const view = render(<VoiceHistory />)
  const user = userEvent.setup()
  const deletes = await screen.findAllByRole('button', { name: /删除练习/ })
  await user.click(deletes[0])
  expect(await listVoiceHistory()).toHaveLength(2)
  confirm.mockReturnValue(true)
  await user.click(deletes[0])
  await waitFor(() => expect(screen.getAllByRole('button', { name: /回看练习/ })).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: '清空历史' }))
  await screen.findByText(/还没有保存的语音练习/)
  view.unmount(); await closeDatabase()
  render(<VoiceHistory />)
  expect(await screen.findByText(/还没有保存的语音练习/)).toBeInTheDocument()
})

it('clears the detail when the selected session is deleted', async () => {
  await clearVoiceHistory(); await seed('待删除的练习')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<VoiceHistory />)
  await userEvent.click(await screen.findByRole('button', { name: /回看练习/ }))
  expect(await screen.findByRole('article', { name: '练习历史详情' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /删除练习/ }))
  await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
})

it('refreshes history and removes an open detail when a remote deletion is applied', async () => {
  await seed('同步删除的练习')
  render(<VoiceHistory />)
  await userEvent.click(await screen.findByRole('button', { name: /回看练习/ }))
  expect(screen.getByRole('article', { name: '练习历史详情' })).toBeInTheDocument()
  await act(async () => { await clearVoiceHistory(); window.dispatchEvent(new Event(VOICE_HISTORY_APPLIED)) })
  await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /回看练习/ })).not.toBeInTheDocument()
})

it('downloads private cloud audio only on request and offers a retry after a network failure', async () => {
  const account = '00000000-0000-0000-0000-000000000001'
  await selectDatabaseAccount(account)
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:test-audio' }; static revokeObjectURL() {} })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  await (await getDatabase()).put('voiceHistory', { id: '10000000-0000-0000-0000-000000000001', mode: 'messages', scenario: 'daily', description: '', difficulty: 'basic', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', elapsedSeconds: 5, feedback: null, corrections: {}, turns: [{ id: 'remote-turn', role: 'user', text: 'Hello', final: true, interrupted: false, duration: 3, audioPath: `${account}/10000000-0000-0000-0000-000000000001/${'a'.repeat(64)}.wav` }] })
  audioDownload.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Blob(['wav']))
  render(<VoiceHistory />)
  await userEvent.click(await screen.findByRole('button', { name: /回看练习/ }))
  expect(audioDownload).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '加载云端录音' }))
  await userEvent.click(await screen.findByRole('button', { name: '重试加载云端录音' }))
  expect(await screen.findByRole('button', { name: '播放你的 3 秒语音' })).toBeInTheDocument()
  expect(audioDownload).toHaveBeenCalledTimes(2)
})
