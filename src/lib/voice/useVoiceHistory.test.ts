import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useVoiceHistory } from './useVoiceHistory'
import { clearDatabase, closeDatabase, getDatabase } from '../db'
import { listVoiceHistory } from './history'

afterEach(async () => { vi.restoreAllMocks(); await clearDatabase(); await closeDatabase() })

it('reports a storage failure and preserves the pending content for explicit retry', async () => {
  const db = await getDatabase()
  const transaction = vi.spyOn(db, 'transaction').mockImplementationOnce(() => { throw new DOMException('Storage full', 'QuotaExceededError') })
  const { result } = renderHook(() => useVoiceHistory())
  act(() => {
    result.current.begin({ mode: 'realtime', scenario: 'daily', description: '', difficulty: 'basic' })
    result.current.save({ turns: [{ id: 'u1', role: 'user', text: 'Keep this sentence.', final: true, interrupted: false }] })
  })
  await waitFor(() => expect(result.current.status).toContain('保存失败'))
  transaction.mockRestore()
  expect(await listVoiceHistory()).toHaveLength(0)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.status).toContain('已保存到本机'))
  expect(await listVoiceHistory()).toHaveLength(1)
})
