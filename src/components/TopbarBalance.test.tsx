import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { apiFetch, setApiTokenProvider } from '../lib/apiFetch'
import type { CloudMembership } from '../lib/cloud/client'
import { MembershipBalanceProvider } from '../lib/cloud/membershipBalance'
import { AppShell } from './AppShell'
import { MembershipPlans } from './MembershipPlans'

const standard: CloudMembership = { plan: 'standard', expires_at: null, trial_expired: false, credits: 5000, voice_ms: 1_800_000 }
const shell = (content = false) => <AppShell activeTab="today" onChangeTab={() => {}} onOpenSettings={() => {}}>
  {content && <MembershipPlans onExplore={() => {}} />}
</AppShell>

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setApiTokenProvider(null)
})

it('keeps the balance private and shows the member reset times from the top bar', () => {
  const guest = render(shell())
  expect(screen.queryByLabelText('查看我的余量')).not.toBeInTheDocument()
  guest.unmount()

  render(<MembershipBalanceProvider membership={standard} load={vi.fn()}>{shell()}</MembershipBalanceProvider>)
  const trigger = screen.getByLabelText('查看我的余量')
  expect(trigger).toHaveTextContent('30分00秒')
  expect(trigger).toHaveTextContent('5,000')
  fireEvent.click(trigger)
  expect(screen.getByText('每日 00:00 刷新')).toBeVisible()
  expect(screen.getByText('每月 1 日 00:00 刷新')).toBeVisible()
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(trigger.closest('details')).not.toHaveAttribute('open')
})

it('refreshes the same server balance for the bar and plans after a metered request', async () => {
  const load = vi.fn().mockResolvedValue({ ...standard, credits: 4980, voice_ms: 0 })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
  setApiTokenProvider(async () => 'test')
  render(<MembershipBalanceProvider membership={standard} load={load}>{shell(true)}</MembershipBalanceProvider>)
  await apiFetch('/api/voice/config')
  expect(load).not.toHaveBeenCalled()
  await act(async () => { await apiFetch('/api/voice/messages/test/turns', { method: 'POST' }) })
  const trigger = screen.getByLabelText('查看我的余量')
  expect(within(trigger).getByText('已用尽')).toBeVisible()
  expect(trigger).toHaveTextContent('4,980')
  expect(screen.getByText(/剩余语音消息 0 分 0 秒 · 4,980 积分/)).toBeVisible()
})

it('polls only while visible and preserves the last confirmed numbers on failure', async () => {
  vi.useFakeTimers()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...standard, credits: 4999 })
  const view = render(<MembershipBalanceProvider membership={standard} load={load}>{shell()}</MembershipBalanceProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(load).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible')
  await act(async () => { fireEvent(window, new Event('focus')) })
  const trigger = screen.getByLabelText('查看我的余量')
  expect(trigger).toHaveTextContent('5,000')
  expect(trigger).toHaveTextContent('待刷新')
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(trigger).toHaveTextContent('4,999')
  expect(trigger).not.toHaveTextContent('待刷新')
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(load).toHaveBeenCalledTimes(2)
})

it('refreshes again when another metered request completes during an active refresh', async () => {
  let finish!: (value: CloudMembership) => void
  const load = vi.fn()
    .mockReturnValueOnce(new Promise<CloudMembership>(resolve => { finish = resolve }))
    .mockResolvedValue({ ...standard, credits: 4980 })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
  setApiTokenProvider(async () => 'test')
  render(<MembershipBalanceProvider membership={standard} load={load}>{shell()}</MembershipBalanceProvider>)
  const path = '/api/deepseek/v1/chat/completions'
  await act(async () => {
    await apiFetch(path, { method: 'POST' })
    await apiFetch(path, { method: 'POST' })
  })
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => { finish({ ...standard, credits: 4990 }) })
  await waitFor(() => expect(screen.getByLabelText('查看我的余量')).toHaveTextContent('4,980'))
  expect(load).toHaveBeenCalledTimes(2)
})
