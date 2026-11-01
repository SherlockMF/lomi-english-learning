import { useState } from 'react'

export interface AccountControls {
  email: string
  syncMessage: string
  onResetPassword: () => Promise<void>
  onSignOut: () => void
  signOutDisabled?: boolean
  error?: string
}

export function AccountDataSection({ managed, account, onRequestLogin, onClearLocal }: {
  managed: boolean; account?: AccountControls; onRequestLogin?: () => void; onClearLocal?: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const deletionMail = `mailto:847542343@qq.com?subject=${encodeURIComponent('Lomi English 账号与数据删除申请')}&body=${encodeURIComponent(`我希望申请删除 Lomi English 账号与云端学习数据。\n账号邮箱：${account?.email ?? '请填写受邀邮箱'}\n请先联系我确认身份、数据范围与备份情况。\n我理解发送此邮件不代表删除已经完成。`)}`
  async function resetPassword() {
    if (!account) return
    setBusy(true); setMessage('')
    try { await account.onResetPassword(); setMessage('密码重置邮件已请求发送，请检查账号邮箱。') }
    catch { setMessage('邮件暂时无法发送，请稍后重试。') }
    finally { setBusy(false) }
  }
  return <div className="settings-section account-data-section">
    <div className="settings-copy"><h3>账号与数据</h3><p>{onRequestLogin ? '当前为访客浏览，登录后使用个人学习库。' : managed ? '学习记录保存在本机缓存，并同步到当前账号。' : '当前为本地模式，学习记录只存在这个浏览器中。'}</p></div>
    {account && <><p>{account.email}</p><p>同步状态：{account.syncMessage}</p><div className="backup-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void resetPassword()}>重置登录密码</button><button type="button" className="secondary-button" disabled={busy || account.signOutDisabled} onClick={account.onSignOut}>退出当前账号</button></div><p className="form-note">退出登录不会清除这台设备的缓存。使用共享设备时，请在确认同步或备份完成后，通过浏览器的站点设置清除本站数据。</p></>}
    {onRequestLogin && <button type="button" className="secondary-button" onClick={onRequestLogin}>登录管理账号</button>}
    <details className="data-details"><summary>数据保存在哪里，哪些内容会发送给 AI</summary>
      <ul><li>词条、复习进度、作答、学习计时与设置：{managed ? '保存于本机，并通过 Supabase 同步；Render 承载应用与服务代理。' : '保存在本机 IndexedDB，备份由你下载保存。'}</li><li>口语录音与对话：发给千问生成回复。对话文字、反馈和语音消息录音保存在本机，刷新后仍保留，可在「口语 → 练习历史」回看或删除；实时畅聊不保存录音。{managed ? '文字、反馈和语音消息录音会同步到当前账号的 Supabase；录音私有保存，按需下载。删除会同步到云端和其他设备，联网后生效。清除本机缓存不会删除已同步的云历史。' : '本地模式不上传云端。'}历史不进入学习备份。第三方处理与保留规则以对应服务说明为准。</li><li>判分、提示与口语纠错：相关文字会发给 DeepSeek。实时逐句纠错会自动发送本句转写与上一条完整 AI 发言；总结由你点击生成。</li><li>主动加入复习的表达、中文意思与纠错说明：作为个人词条保存，{managed ? '会同步到云端，' : ''}也会进入学习备份；词条不附带原始录音。</li><li>账号登录信息和 API Key 不包含在学习备份中。备份可能包含你的个人表达，请妥善保管。</li></ul>
    </details>
    {managed && !onRequestLogin && <details className="data-details"><summary>删除账号或云端数据</summary><p>先导出学习备份，再使用账号邮箱向管理员发送申请。管理员核实身份、确认删除范围后处理；打开邮件或发送申请都不代表已经删除。删除完成前仍可联系管理员取消申请。</p><a className="secondary-button" href={deletionMail}>申请删除账号与云端数据</a><p className="form-note">若没有邮件应用，请发邮件至 847542343@qq.com，注明账号邮箱和删除范围，不要发送密码。云端删除后，各设备上的浏览器缓存与已下载备份仍需自行清除。</p></details>}
    {!managed && onClearLocal && <details className="data-details"><summary>清除本机学习数据</summary><p>会清除本浏览器中的个人词条、学习记录、语音练习历史与录音、设置和词典缓存，无法撤销。请先使用下方「学习备份」导出词条和进度；语音历史不在备份中，需要在练习历史中另行下载文字。不会删除你下载的备份文件或服务配置。</p><label className="text-setting"><span>输入「清除本机数据」确认</span><input value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><button type="button" className="secondary-button" disabled={busy || confirmation !== '清除本机数据'} onClick={async () => { setBusy(true); setMessage(''); try { await onClearLocal() } catch { setMessage('清除失败，请重试。') } finally { setBusy(false) } }}>清除本机学习数据</button></details>}
    {account?.error && <p role="alert">{account.error}</p>}
    {message && <p role="status">{message}</p>}
  </div>
}
