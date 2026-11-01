import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { VoiceHistory } from './VoiceHistory'
import { createVoiceHistoryWriter, clearVoiceHistory, listVoiceHistory } from '../lib/voice/history'
import { clearDatabase, closeDatabase } from '../lib/db'

afterEach(async () => { cleanup(); await clearDatabase(); await closeDatabase(); vi.restoreAllMocks() })
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
