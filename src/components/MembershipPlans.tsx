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
  return <section className="page-stack membership-page" aria-labelledby="membership-title">
    <header className="membership-heading">
      <div><p className="eyebrow">A LITTLE ENGLISH, EVERY DAY</p><h1 id="membership-title">给每天的英语，留一点时间。</h1><p>从轻量开口，到认真练习。按你的节奏，了解适合自己的方案。</p></div>
      <span className="membership-preview-label">套餐预览</span>
    </header>

    <div className="membership-notice"><Icon name="clock" size={20} aria-hidden="true" /><p><strong>暂未开放购买。</strong>以下为拟推出的月度套餐，当前使用不受影响；每日时长和积分规则尚未启用。</p></div>

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
      <h2 id="membership-rules-title">未来的额度，怎样使用？</h2>
      <p>以下为套餐开放后的计划规则，当前不会据此计时限额或扣积分。价格币种为马来西亚林吉特（MYR）。</p>
      <details><summary>每日口语与通用积分，有什么区别？</summary><p>每日口语包含练习中的逐句纠错和课后总结，不消耗通用积分。通用积分用于文字 AI 辅助，或每日口语用完后的额外练习；不同任务按实际模型用量折算积分，不按固定调用次数计费。额外口语会先提示，由你确认后再用积分。</p></details>
      <details><summary>额度什么时候刷新？</summary><p>每日口语计划按马来西亚时间 00:00 刷新，当天未用完不累计。月度通用积分按会员周期刷新，未用完不滚存；暂停、断线和服务等待不计入练习时间。</p></details>
      <details><summary>现在能开通套餐吗？</summary><p>目前仅展示方案，尚未开放购买或会员开通，也不会自动收费。你可以继续按现有方式浏览和练习，开始个人学习或口语练习时需登录受邀账号。</p></details>
    </section>

    <div className="membership-footer"><p>先找到自己的节奏，再选择适合的方案。</p><button className="secondary-button" type="button" onClick={onExplore}>去口语页看看<Icon name="arrow" size={17} aria-hidden="true" /></button></div>
  </section>
}
