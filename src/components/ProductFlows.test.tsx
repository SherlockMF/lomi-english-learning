import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../domain/types'
import { OnboardingDialog } from './OnboardingDialog'
import { SaveVoiceExpression } from './SaveVoiceExpression'
import { AccountDataSection } from './AccountDataSection'

afterEach(cleanup)

it('does not promise a three-expression lesson when a returning learner reopens setup', () => {
  render(<OnboardingDialog settings={DEFAULT_SETTINGS} hasLearningHistory onComplete={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByRole('button', { name: '保存并开始学习' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '开始第一课' })).not.toBeInTheDocument()
})

it('saves first-lesson choices and supports keeping the dialog open on failure', async () => {
  const complete = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
  render(<OnboardingDialog settings={DEFAULT_SETTINGS} onComplete={complete} onClose={vi.fn()} />)
  expect(screen.getByRole('button', { name: '开始第一课' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: '商业英语' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '校园学术' }))
  fireEvent.click(screen.getByRole('button', { name: '上移校园学术' }))
  fireEvent.click(screen.getByRole('button', { name: '开始第一课' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('设置未保存成功')
  fireEvent.click(screen.getByRole('button', { name: '保存，先逛逛' }))
  await waitFor(() => expect(complete).toHaveBeenLastCalledWith(expect.objectContaining({
    learningGoal: 'campus', activeCategories: ['campus', 'business'], onboardingCompletedAt: expect.any(String),
  }), false))
})

it('does not save a correction explanation as the Chinese translation', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(<SaveVoiceExpression draft={{ expression: 'I went home.', meaning: '', note: '这里使用过去时' }} onSave={save} />)
  fireEvent.click(screen.getByRole('button', { name: '加入复习' }))
  expect(screen.getByRole('button', { name: '确认加入复习' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('表达的中文意思'), { target: { value: '我回家了。' } })
  fireEvent.click(screen.getByRole('button', { name: '确认加入复习' }))
  expect(await screen.findByRole('status')).toHaveTextContent('已加入优先学习')
  expect(save).toHaveBeenCalledWith({ expression: 'I went home.', meaning: '我回家了。', note: '这里使用过去时' })
})

it('shows a deletion request with no destructive local button in cloud mode', () => {
  render(<AccountDataSection managed account={{ email: 'learner@example.com', syncMessage: '已同步', onResetPassword: vi.fn(), onSignOut: vi.fn() }} />)
  expect(screen.getByRole('link', { name: '申请删除账号与云端数据' })).toHaveAttribute('href', expect.stringContaining('mailto:'))
  expect(screen.queryByRole('button', { name: '清除本机学习数据' })).not.toBeInTheDocument()
})
