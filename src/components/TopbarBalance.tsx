import { useEffect, useId, useRef } from 'react'
import { useMembershipBalance } from '../lib/cloud/membershipBalance'
import { Icon } from './Icon'

export function TopbarBalance() {
  const balance = useMembershipBalance()
  const disclosure = useRef<HTMLDetailsElement>(null)
  const descriptionId = useId()
  const visible = balance !== null

  useEffect(() => {
    if (!visible) return
    function dismiss(event: PointerEvent) {
      const details = disclosure.current
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [visible])

  if (!balance) return null
  const { membership, stale } = balance
  const seconds = Math.floor(membership.voice_ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, '0')
  const voice = seconds ? `${minutes}分${remainder}秒` : '已用尽'
  const credits = membership.credits.toLocaleString('zh-CN')
  const standard = membership.plan === 'standard'
  const trialEnd = membership.expires_at
    ? new Date(membership.expires_at).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
    : null

  return <div className="topbar-balance">
    <span id={descriptionId} className="topbar-balance-description" role="status">
      语音消息剩余 {voice}，积分剩余 {credits}{stale ? '，待刷新' : ''}
    </span>
    <details ref={disclosure} onKeyDown={event => {
      if (event.key === 'Escape' && event.currentTarget.open) {
        event.stopPropagation()
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }
    }}>
      <summary aria-label="查看我的余量" aria-describedby={descriptionId}>
        <span className="topbar-balance-metric"><Icon name="mic" size={15} />
          <span><small>语音消息<span className="topbar-balance-label-detail">剩余</span></small><strong className={seconds ? undefined : 'balance-empty'}>{voice}</strong></span>
        </span>
        <span className="topbar-balance-metric"><Icon name="spark" size={15} />
          <span><small>{stale ? '积分 · 待刷新' : '积分剩余'}</small><strong className={membership.credits ? undefined : 'balance-empty'}>{membership.credits ? credits : '已用尽'}</strong></span>
        </span>
        <Icon name="chevron" size={14} className="topbar-balance-chevron" />
      </summary>
      <div className="topbar-balance-panel">
        <div className="topbar-balance-panel-head"><h2>我的余量</h2><span>{standard ? '标准档 · 永久' : '15 天免费试用'}</span></div>
        <dl>
          <div><dt>语音消息</dt><dd>{seconds ? `剩余 ${minutes} 分 ${remainder} 秒` : '已用尽'}</dd>
            <dd className="topbar-balance-cycle">{standard ? '每日 00:00 刷新' : '试用期总额'}</dd></div>
          <div><dt>文字 AI 积分</dt><dd>{membership.credits ? `剩余 ${credits} 积分` : '已用尽'}</dd>
            <dd className="topbar-balance-cycle">{standard ? '每月 1 日 00:00 刷新' : '试用期总额'}</dd></div>
        </dl>
        <p>{standard ? '马来西亚时间' : membership.trial_expired ? '试用已结束' : trialEnd && `${trialEnd} 到期`}</p>
        {stale && <p>待刷新 · 当前显示上次确认的余量</p>}
      </div>
    </details>
  </div>
}
