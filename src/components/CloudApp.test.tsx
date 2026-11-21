import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'

const fake = vi.hoisted(() => ({
  session: null as Session | null, active: true, neon: false, signIn: vi.fn(), signOut: vi.fn(),
  register: vi.fn(), verify: vi.fn(),
}))
vi.mock('../lib/cloud/client', () => ({ getCloudClient: () => ({
  auth: { getSession: async () => ({ data: { session: fake.session }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }), signInWithPassword: fake.signIn, signOut: fake.signOut, resetPasswordForEmail: vi.fn(), ...(fake.neon ? { getBetterAuthInstance: vi.fn() } : {}) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { active: fake.active }, error: null }) }) }) }),
}), beginCloudRegistration: fake.register, verifyCloudRegistration: fake.verify, resendCloudRegistrationCode: vi.fn(), MIN_CLOUD_PASSWORD_LENGTH: 8 }))
vi.mock('../App', () => ({ default: ({ onRequestLogin, preserveVocabulary }: { onRequestLogin?: () => void; preserveVocabulary?: boolean }) => onRequestLogin
  ? <div>访客浏览页面<button onClick={onRequestLogin}>开始今天的训练</button></div>
  : <div>受保护的学习页面{preserveVocabulary && <span>保留现有词库</span>}</div> }))
vi.mock('../lib/cloud/sync', () => ({ createCloudSync: () => ({ start: vi.fn(), stop: vi.fn(), sync: vi.fn(), resolve: vi.fn() }) }))
import { CloudApp } from './CloudApp'
import { selectDatabaseAccount } from '../lib/db'

afterEach(async () => { cleanup(); fake.session = null; fake.active = true; fake.neon = false; vi.clearAllMocks(); await selectDatabaseAccount(null) })

it('allows browsing and opens a dismissible login only when requested', async () => {
  render(<CloudApp />)
  expect(await screen.findByText('访客浏览页面')).toBeInTheDocument()
  expect(screen.queryByLabelText('邮箱')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '开始今天的训练' }))
  expect(screen.getByRole('dialog', { name: '登录后继续' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '继续浏览' }))
  expect(screen.queryByLabelText('邮箱')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('requires a login for use and does not expose public registration', async () => {
  fake.signIn.mockResolvedValue({ error: { message: 'invalid' } })
  render(<CloudApp />)
  fireEvent.click(await screen.findByRole('button', { name: '开始今天的训练' }))
  const email = await screen.findByLabelText('邮箱')
  expect(screen.queryByText('受保护的学习页面')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '注册' })).not.toBeInTheDocument()
  fireEvent.change(email, { target: { value: 'invited@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'example-password' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '登录' }))
  await waitFor(() => expect(fake.signIn).toHaveBeenCalledWith({ email: 'invited@example.com', password: 'example-password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码')
})

it('does not mount user data for a disabled account', async () => {
  fake.active = false
  fake.session = { user: { id: '11111111-1111-4111-8111-111111111111', email: 'disabled@example.com' } } as Session
  render(<CloudApp />)
  expect(await screen.findByRole('alert')).toHaveTextContent('尚未启用')
  expect(screen.queryByText('受保护的学习页面')).not.toBeInTheDocument()
})

it('opens the account after sign-in when the provider does not broadcast an event to the current tab', async () => {
  fake.signIn.mockResolvedValue({ data: { session: { user: { id: '44444444-4444-4444-8444-444444444444', email: 'invited@example.com' } } }, error: null })
  render(<CloudApp />)
  fireEvent.click(await screen.findByRole('button', { name: '开始今天的训练' }))
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'invited@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'example-password' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '登录' }))
  expect(await screen.findByText('受保护的学习页面')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('opens only the authenticated account database after checking access', async () => {
  fake.session = { user: { id: '22222222-2222-4222-8222-222222222222', email: 'invited@example.com' } } as Session
  render(<CloudApp />)
  expect(await screen.findByText('受保护的学习页面')).toBeInTheDocument()
  expect(screen.getByText('invited@example.com')).toBeInTheDocument()
})

it('shows a failed sign-out without hiding the account workspace', async () => {
  fake.session = { user: { id: '33333333-3333-4333-8333-333333333333', email: 'invited@example.com' } } as Session
  fake.signOut.mockRejectedValueOnce(new Error('offline'))
  render(<CloudApp />)
  await screen.findByText('受保护的学习页面')
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('退出失败')
  expect(screen.getByText('受保护的学习页面')).toBeInTheDocument()
})

it.each([
  ['2026-11-19T09:39:28Z', true],
  ['2026-11-22T08:00:00Z', false],
  [undefined, true],
] as const)('selects the vocabulary release path for account creation time %s', async (createdAt, preserve) => {
  fake.session = { user: { id: '22222222-2222-4222-8222-222222222222', created_at: createdAt } } as Session
  render(<CloudApp />)
  await screen.findByText('受保护的学习页面')
  expect(Boolean(screen.queryByText('保留现有词库'))).toBe(preserve)
})

it('lets Neon users register with an eight-character password and verify by email before signing in', async () => {
  fake.neon = true
  fake.register.mockResolvedValue({ error: null })
  fake.verify.mockResolvedValue({ error: null })
  render(<CloudApp />)
  fireEvent.click(await screen.findByRole('button', { name: '开始今天的训练' }))
  fireEvent.click(screen.getByRole('button', { name: '注册' }))
  expect(screen.getByLabelText('密码')).toHaveAttribute('minlength', '8')
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'eight123' } })
  fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(await screen.findByLabelText('邮箱验证码')).toBeInTheDocument()
  expect(fake.register).toHaveBeenCalledWith(expect.anything(), 'new@example.com', 'eight123')
  fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '验证邮箱' }))
  expect(await screen.findByText('邮箱已验证，请登录。')).toBeInTheDocument()
  expect(fake.verify).toHaveBeenCalledWith(expect.anything(), 'new@example.com', '123456')
})

it('lets an account resume email verification from the login form', async () => {
  fake.neon = true
  fake.signIn.mockResolvedValue({ data: { session: null }, error: { code: 'email_not_confirmed' } })
  render(<CloudApp />)
  fireEvent.click(await screen.findByRole('button', { name: '开始今天的训练' }))
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'unverified@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'eight123' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '登录' }))
  expect(await screen.findByRole('dialog', { name: '验证邮箱' })).toHaveTextContent('unverified@example.com')
  expect(screen.getByRole('button', { name: '重发验证码' })).toBeInTheDocument()
})
