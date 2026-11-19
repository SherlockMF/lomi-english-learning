import { useMembershipBalance } from '../lib/cloud/membershipBalance'
import { Icon } from './Icon'

const plans = [
  { id: 'starter', name: '入门', english: 'STARTER', price: 39, minutes: 10, credits: '1,000',
    title: '每天开口一点', description: '给通勤、课间和睡前，留一段轻松的英语时间。', recommended: false },
  { id: 'standard', name: '标准', english: 'STANDARD', price: 69, minutes: 30, credits: '5,000',
    title: '把英语练成日常习惯', description: '从热身到场景对话，再回看纠错，找到稳定的学习节奏。', recommended: true },
  { id: 'pro', name: 'Pro', english: 'PRO', price: 99, minutes: 60, credits: '10,000',
    title: '为高频练习留足空间', description: '适合面试准备、工作沟通，以及想多聊一会儿的日子。', recommended: false },
]

const included = ['口语内逐句纠错与课后总结', '口语表达确认后加入复习', '完整词库、常规复习与学习记录', '相同的标准口语模型质量']

export function MembershipPlans({ onExplore }: { onExplore: () => void }) {
  const balance = useMembershipBalance()
  const membership = balance?.membership
  const seconds = membership ? Math.floor(membership.voice_ms / 1000) : 0
  return <section className="page-stack membership-page" aria-labelledby="membership-title">
    <header className="membership-heading">
      <div><p className="eyebrow">A LITTLE ENGLISH, EVERY DAY</p><h1 id="membership-title">给每天的英语，留一点时间。</h1><p>从轻量开口，到认真练习。按你的节奏，了解适合自己的方案。</p></div>
      <span className="membership-preview-label">套餐预览</span>
    </header>

    {membership && <div className="membership-notice"><Icon name="clock" size={20} aria-hidden="true" /><p>
      <strong>{membership.plan === 'standard' ? '标准档 · 永久' : '15 天免费试用'}</strong>
      {' · 剩余语音消息 '}{Math.floor(seconds / 60)} 分 {seconds % 60} 秒 · {membership.credits.toLocaleString('zh-CN')} 积分
      {membership.expires_at && (membership.trial_expired ? ' · 试用已结束' : ` · ${new Date(membership.expires_at).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })} 到期`)}
      {balance?.stale && ' · 待刷新'}
    </p></div>}
    <div className="membership-notice"><Icon name="clock" size={20} aria-hidden="true" /><p><strong>暂未开放购买。</strong>以下月度套餐供预览。</p></div>

    <div className="membership-grid">
      {plans.map(plan => <article key={plan.id} aria-labelledby={`plan-${plan.id}`} className={`membership-card${plan.recommended ? ' membership-card-recommended' : ''}`}>
        <div className="membership-card-top"><span>{plan.english}</span>{plan.recommended && <span className="membership-recommendation"><Icon name="spark" size={14} aria-hidden="true" />推荐</span>}</div>
        <h2 id={`plan-${plan.id}`}>{plan.name}</h2>
        <p className="membership-price"><span>RM</span><strong>{plan.price}</strong><span>/ 月</span></p>
        <h3>{plan.title}</h3><p className="membership-description">{plan.description}</p>
        <dl className="membership-allowances">
          <div><dt>每日标准口语</dt><dd><strong>{plan.minutes}</strong> 分钟</dd></div>
          <div><dt>每月通用积分</dt><dd><strong>{plan.credits}</strong> 积分</dd></div>
        </dl>
        <p className="membership-card-note">口语内纠错与总结已包含，不重复扣通用积分。</p>
        <div className="membership-card-status">筹备中 · 尚未开放订购</div>
      </article>)}
    </div>

    <section className="membership-included" aria-labelledby="membership-included-title">
      <div><p className="eyebrow">SAME CARE, YOUR OWN PACE</p><h2 id="membership-included-title">每一档，都认真对待你的进步。</h2><p>三档主要区别是练习用量，核心学习体验保持完整。</p></div>
      <ul>{included.map(text => <li key={text}><Icon name="check" size={18} aria-hidden="true" />{text}</li>)}</ul>
    </section>

    <section className="membership-rules" aria-labelledby="membership-rules-title">
      <h2 id="membership-rules-title">额度怎样使用？</h2>
      <details><summary>语音消息和积分怎么算？</summary><p>语音消息按发送的录音时长扣除。文字 AI 每使用 100 个模型 token 扣 1 积分，零头向上取整。</p></details>
      <details><summary>额度什么时候刷新？</summary><p>试用的 10 分钟语音消息和 1,000 积分是 15 天总额。标准档的语音消息按马来西亚时间每日 00:00 刷新，积分在每月 1 日刷新。</p></details>
      <details><summary>用完额度后还能学习吗？</summary><p>可以继续学习、复习、同步和回听已保存的录音。套餐尚未开放购买。</p></details>
    </section>

    <div className="membership-footer"><p>先找到自己的节奏，再选择适合的方案。</p><button className="secondary-button" type="button" onClick={onExplore}>去口语页看看<Icon name="arrow" size={17} aria-hidden="true" /></button></div>
  </section>
}
