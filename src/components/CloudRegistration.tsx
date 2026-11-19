import { useEffect, useRef, useState } from 'react'
import { beginCloudRegistration, MIN_CLOUD_PASSWORD_LENGTH, resendCloudRegistrationCode, verifyCloudRegistration, type CloudClient } from '../lib/cloud/client'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { useFocusTrap } from '../lib/useFocusTrap'

export function CloudRegistration({ client, verifyEmail, onClose, onVerified }: {
  client: CloudClient
  verifyEmail: string
  onClose: () => void
  onVerified: (email: string) => void
}) {
  const dialog = useRef<HTMLFormElement>(null)
  useFocusTrap(dialog)
  useEscapeToClose(onClose)
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])
  const [email, setEmail] = useState(verifyEmail)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(Boolean(verifyEmail))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const address = email.trim()
      if (verifying) {
        const result = await verifyCloudRegistration(client, address, code.trim())
        if (result.error) setError('验证码不正确或已过期，请重试或重新发送。')
        else onVerified(address)
      } else {
        const result = await beginCloudRegistration(client, address, password)
        if (result.error) {
          setError(result.error.code === 'USER_ALREADY_EXISTS' || result.error.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
            ? '这个邮箱已注册，请直接登录或使用「忘记密码」。'
            : '暂时无法注册。请检查邮箱、密码长度，或稍后重试。')
        } else {
          setPassword('')
          setVerifying(true)
          setNotice('请查收邮箱验证码。')
        }
      }
    } catch { setError('请求未完成，请检查网络后重试。') }
    finally { setBusy(false) }
  }

  async function resend() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await resendCloudRegistrationCode(client, email.trim())
      if (result.error) setError('暂时无法重发验证码，请稍后再试。')
      else setNotice('已发送验证码，请查收。')
    } catch { setError('发送未完成，请检查网络后重试。') }
    finally { setBusy(false) }
  }

  return <div className="dialog-backdrop auth-backdrop"><form ref={dialog} className="auth-card" role="dialog" aria-modal="true" aria-labelledby="registration-title" onSubmit={event => { event.preventDefault(); void submit() }}>
    <span className="loading-mark">L</span><h1 id="registration-title">{verifying ? '验证邮箱' : '注册账号'}</h1>
    <p>{verifying ? `输入发送到 ${email.trim()} 的验证码。` : '验证邮箱后开始 15 天试用，含 10 分钟语音消息录音和 1,000 文字 AI 积分。'}</p>
    {verifying ? <label className="text-setting"><span>邮箱验证码</span><input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label> : <>
      <label className="text-setting"><span>邮箱</span><input type="email" autoComplete="username" maxLength={254} required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
      <label className="text-setting"><span>密码</span><input type="password" autoComplete="new-password" minLength={MIN_CLOUD_PASSWORD_LENGTH} maxLength={128} required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      <small>密码至少 {MIN_CLOUD_PASSWORD_LENGTH} 位。</small>
    </>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? '正在处理…' : verifying ? '验证邮箱' : '发送验证码'}</button>
    {verifying && <button className="secondary-button" type="button" disabled={busy} onClick={() => void resend()}>重发验证码</button>}
    <button className="mini-text-button" type="button" disabled={busy} onClick={onClose}>返回登录</button>
  </form></div>
}
