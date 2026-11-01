import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import App from '../App'
import { getCloudClient } from '../lib/cloud/client'
import { setApiTokenProvider } from '../lib/apiFetch'
import { getDatabaseAccount, selectDatabaseAccount, setDatabaseTrackingEnabled } from '../lib/db'
import { createCloudSync, type CloudConflict, type CloudSyncState, type CloudTransport } from '../lib/cloud/sync'
import { restoreCloudCache } from '../lib/cloud/storage'
import { createCloudBroadcast } from '../lib/cloud/broadcast'
import { CLOUD_DATA_CHANGED } from '../lib/cloud/types'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { useFocusTrap } from '../lib/useFocusTrap'
import type { AppTab } from './AppShell'
import { createVoiceHistorySync, type VoiceCloudState } from '../lib/voice/historyCloud'
import { createVoiceHistoryTransport } from '../lib/voice/historyTransport'

export const CLOUD_APPLIED = 'recall-cloud-data-applied'

export function CloudApp() {
  const [client] = useState(getCloudClient)
  const [session, setSession] = useState<Session | null>()
  const [readyAccount, setReadyAccount] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [browsingTab, setBrowsingTab] = useState<AppTab>('today')
  const requestLogin = useCallback(() => setLoginOpen(true), [])
  const closeLogin = useCallback(() => setLoginOpen(false), [])
  const [passwordSetup, setPasswordSetup] = useState(['/auth/invite', '/auth/update-password'].includes(window.location.pathname))
  const boundAccount = useRef<string | null>(null)
  const userId = session?.user.id
  useEffect(() => {
    let active = true
    let authRevision = 0
    setApiTokenProvider(async () => {
      const result = await client.auth.getSession()
      return result.error ? null : result.data.session?.access_token ?? null
    })
    const subscription = client.auth.onAuthStateChange((event, nextSession) => {
      authRevision++
      if (!active) return
      if (boundAccount.current && boundAccount.current !== nextSession?.user.id) {
        // Reload destroys in-flight callbacks before another account can open a database.
        setDatabaseTrackingEnabled(false)
        setApiTokenProvider(null)
        window.location.replace('/')
        return
      }
      if (event === 'PASSWORD_RECOVERY') setPasswordSetup(true)
      setSession(nextSession)
    }).data.subscription
    void client.auth.getSession().then(result => {
      if (!active || authRevision) return
      if (result.error) { setError('无法恢复登录，请重新登录。'); setSession(null) }
      else setSession(result.data.session)
    }).catch(() => { if (active) { setError('无法读取登录状态，请重试。'); setSession(null) } })
    return () => { active = false; subscription.unsubscribe(); setApiTokenProvider(null); setDatabaseTrackingEnabled(false) }
  }, [client])
  useEffect(() => {
    let active = true
    setReadyAccount(null)
    if (!userId) return () => { active = false }
    setChecking(true)
    setError('')
    void (async () => {
      try {
        const result = await client.from('app_memberships').select('active').eq('user_id', userId).maybeSingle()
        if (!active) return
        if (result.error) throw new Error('无法验证账号权限，请检查网络后重试。')
        if (!result.data?.active) throw new Error('账号尚未启用或已停用，请联系邀请你的管理员。')
        await selectDatabaseAccount(userId)
        if (!active) return
        boundAccount.current = userId
        setReadyAccount(userId)
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '无法打开账号。') }
      finally { if (active) setChecking(false) }
    })()
    return () => { active = false }
  }, [client, userId])

  async function signOut() {
    setError('')
    try {
      const result = await client.auth.signOut({ scope: 'local' })
      if (result.error) { setError('退出失败，请重试。'); return }
      window.location.replace('/')
    } catch { setError('退出失败，请检查网络后重试。') }
  }

  if (session === undefined) return <div className="loading-screen" role="status">正在恢复登录…</div>
  if (!session) return <>
    <div inert={loginOpen ? true : undefined}>
      <div className="cloud-account-bar"><span>访客浏览 · 开始使用时再登录</span><button type="button" onClick={requestLogin}>登录</button></div>
      <App onRequestLogin={requestLogin} initialTab={browsingTab} onTabChange={setBrowsingTab} />
    </div>
    {loginOpen && <AuthForm error={error} client={client} onClose={closeLogin} />}
  </>
  if (passwordSetup) return <PasswordSetup client={client} onComplete={() => { window.history.replaceState(null, '', '/'); setPasswordSetup(false) }} />
  if (checking || readyAccount !== session.user.id) return <div className="loading-screen">
    {error ? <p role="alert">{error}</p> : <p role="status">正在验证账号权限…</p>}
    {error && <div className="backup-actions"><button type="button" className="secondary-button" onClick={() => window.location.reload()}>重试</button><button type="button" className="secondary-button" onClick={() => void signOut()}>退出登录</button></div>}
  </div>
  return <AccountWorkspace key={readyAccount} accountError={error} initialTab={browsingTab} email={session.user.email ?? ''} client={client} onSignOut={() => void signOut()} />
}

function AuthForm({ client, error: initialError, onClose }: { client: ReturnType<typeof getCloudClient>; error: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLFormElement>(null)
  useFocusTrap(dialogRef)
  useEscapeToClose(onClose)
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState('')
  async function login() {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) setError('邮箱或密码不正确，或账号尚未接受邀请。')
    } catch { setError('登录未完成，请检查网络后重试。') }
    finally { setBusy(false) }
  }
  async function resetPassword() {
    if (!email.trim()) { setError('请先填写邮箱。'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/update-password` })
      if (result.error) setError('重置邮件暂时无法发送，请稍后重试。')
      else setNotice('如果该邮箱可用于登录，你将收到重置密码邮件。')
    } catch { setError('邮件发送未完成，请检查网络后重试。') }
    finally { setBusy(false) }
  }
  return <div className="dialog-backdrop auth-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form ref={dialogRef} className="auth-card" role="dialog" aria-modal="true" aria-labelledby="login-title" onSubmit={event => { event.preventDefault(); void login() }}>
    <span className="loading-mark">L</span><h1 id="login-title">登录后继续</h1>
    <p>使用受邀邮箱登录，学习记录将同步到你的账号。</p>
    <label className="text-setting"><span>邮箱</span><input type="email" autoComplete="username" required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
    <label className="text-setting"><span>密码</span><input type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? '正在处理…' : '登录'}</button>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void resetPassword()}>忘记密码</button>
    <button className="mini-text-button" type="button" onClick={onClose}>继续浏览</button>
    <small>暂不开放注册。首次使用请打开管理员发送的邀请邮件。</small>
    <small>联系管理员：<a href="mailto:847542343@qq.com">847542343@qq.com</a></small>
  </form></div>
}

function PasswordSetup({ client, onComplete }: { client: ReturnType<typeof getCloudClient>; onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (password !== confirmation) { setError('两次输入的密码不一致。'); return }
    setBusy(true); setError('')
    try {
      const result = await client.auth.updateUser({ password })
      if (result.error) setError('密码更新失败，请检查密码要求或重新获取邮件链接。')
      else onComplete()
    } catch { setError('密码更新未完成，请检查网络后重试。') }
    finally { setBusy(false) }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={event => { event.preventDefault(); void save() }}>
    <h1>设置登录密码</h1><p>请使用至少 12 个字符的密码。</p>
    <label className="text-setting"><span>新密码</span><input type="password" minLength={12} required autoComplete="new-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
    <label className="text-setting"><span>确认新密码</span><input type="password" minLength={12} required autoComplete="new-password" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" className="primary-button" disabled={busy}>{busy ? '正在保存…' : '保存密码并继续'}</button>
  </form></main>
}

function AccountWorkspace({ client, email, onSignOut, initialTab, accountError }: { client: ReturnType<typeof getCloudClient>; email: string; onSignOut: () => void; initialTab: AppTab; accountError: string }) {
  const [appReady, setAppReady] = useState(false)
  const [cacheReady, setCacheReady] = useState(false)
  const [state, setState] = useState<CloudSyncState>({ phase: 'waiting', message: '正在打开账号缓存…', conflicts: [] })
  const busy = useRef(false)
  const remotePending = useRef(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const engine = useRef<ReturnType<typeof createCloudSync> | null>(null)
  const voiceEngine = useRef<ReturnType<typeof createVoiceHistorySync> | null>(null)
  const [voiceState, setVoiceState] = useState<VoiceCloudState>({ phase: 'waiting', message: '语音历史等待同步' })
  const onReady = useCallback(() => setAppReady(true), [])
  const onBusyChange = useCallback((value: boolean) => {
    busy.current = value
    setWorkspaceBusy(value)
    if (!value) {
      if (remotePending.current) { remotePending.current = false; window.dispatchEvent(new Event(CLOUD_APPLIED)) }
      void engine.current?.sync()
    }
  }, [])
  useEffect(() => {
    if (!appReady) return
    let active = true
    const broadcast = createCloudBroadcast(getDatabaseAccount()!, () => {
      if (busy.current) remotePending.current = true
      else window.dispatchEvent(new Event(CLOUD_APPLIED))
    })
    const notify = () => { window.dispatchEvent(new Event(CLOUD_APPLIED)); broadcast.notify() }
    window.addEventListener(CLOUD_DATA_CHANGED, broadcast.notify)
    const transport: CloudTransport = {
      async pull(revision, signal) {
        const result = await client.rpc('cloud_pull', { p_after_revision: revision }).abortSignal(signal!)
        if (result.error) throw result.error
        return result.data
      },
      async apply(revision, changes, signal) {
        const result = await client.rpc('cloud_apply', { p_expected_revision: revision, p_changes: changes }).abortSignal(signal!)
        if (result.error) throw result.error
        return result.data
      },
    }
    void restoreCloudCache().then(() => {
      if (!active) return
      notify()
      setDatabaseTrackingEnabled(true)
      setCacheReady(true)
      engine.current = createCloudSync({ transport, onState: setState, onApplied: notify, isBusy: () => busy.current })
      engine.current.start()
      voiceEngine.current = createVoiceHistorySync({ transport: createVoiceHistoryTransport(client, getDatabaseAccount()!), onState: setVoiceState })
      voiceEngine.current.start()
    }).catch(() => { if (active) setState({ phase: 'error', message: '账号缓存无法恢复，请重新载入页面。', conflicts: [] }) })
    return () => { active = false; engine.current?.stop(); engine.current = null; voiceEngine.current?.stop(); voiceEngine.current = null; window.removeEventListener(CLOUD_DATA_CHANGED, broadcast.notify); broadcast.close(); setDatabaseTrackingEnabled(false) }
  }, [appReady, client])
  async function resolve(conflict: CloudConflict, keepLocal: boolean) {
    try { await engine.current?.resolve(conflict, keepLocal) }
    catch { setState(previous => ({ ...previous, message: '内容又有更新，请重新同步后处理冲突。' })) }
  }
  return <>
    <div className="cloud-account-bar"><span>{email}</span><span role="status">{state.message}{cacheReady ? ` · ${voiceState.message}` : ''}</span>
      <button type="button" onClick={() => { if (!cacheReady) window.location.reload(); else { void engine.current?.sync(); void voiceEngine.current?.sync() } }} disabled={(!cacheReady && state.phase !== 'error') || state.phase === 'syncing' || voiceState.phase === 'syncing'}>{!cacheReady && state.phase === 'error' ? '重新载入' : '同步'}</button>
      <button type="button" onClick={onSignOut} disabled={workspaceBusy || state.phase === 'syncing'}>退出登录</button>
    </div>
    {accountError && !workspaceBusy && <p className="auth-error" role="alert">{accountError}</p>}
    {state.conflicts.length > 0 && <section className="cloud-conflicts" aria-label="同步冲突">
      <p>同一份内容在两台设备上有不同修改。选择前可以在学习设置中导出本机备份。</p>
      {state.conflicts.map(conflict => <div key={conflict.entry.id}>
        <strong>{conflict.label}</strong><details><summary>查看两个版本</summary><div className="conflict-versions"><pre>本机：{JSON.stringify(conflict.entry.data, null, 2)}</pre><pre>云端：{JSON.stringify(conflict.remote, null, 2)}</pre></div></details>
        <button type="button" onClick={() => void resolve(conflict, true)}>使用本机版本</button><button type="button" onClick={() => void resolve(conflict, false)}>使用云端版本</button>
      </div>)}
    </section>}
    {!cacheReady && appReady && <p className="cloud-cache-wait" role="status">正在恢复账号数据…</p>}
    <div inert={appReady && !cacheReady ? true : undefined}><App initialTab={initialTab} onReady={onReady} onBusyChange={onBusyChange} dataReady={cacheReady && state.phase === 'synced'} account={{ email, error: accountError, syncMessage: `${state.message} · ${voiceState.message}`, onSignOut, signOutDisabled: state.phase === 'syncing', onResetPassword: async () => {
      const result = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/update-password` })
      if (result.error) throw result.error
    } }} /></div>
  </>
}
