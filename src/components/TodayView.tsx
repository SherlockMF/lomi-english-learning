import type { MapLearningProgress, LearningTrackSnapshot } from '../lib/learningTracks'
import type { DailyPlan } from '../lib/scheduler'
import type { LearningStats } from '../lib/learningStats'
import { formatToday, greetingFor } from '../lib/presentation'
import { Icon } from './Icon'

interface TodayViewProps {
  now: Date
  plan: DailyPlan
  stats: LearningStats
  tracks: LearningTrackSnapshot[]
  mapProgress: MapLearningProgress
  recentWords: { expression: string; zhGloss: string; stage: string }[]
  onStart: () => void
  onStartExtra?: () => void
}

export function TodayView({
  now,
  plan,
  stats,
  tracks,
  mapProgress,
  recentWords,
  onStart,
  onStartExtra,
}: TodayViewProps) {
  const noHintRate = stats.delayedRecall.rate === null ? null : Math.round(stats.delayedRecall.rate * 100)
  const usedMinutes = Math.round(plan.usedMs / 6000) / 10
  const hasTasks = plan.totalTasks > 0
  const practicedToday = stats.practicedItems > 0
  const startedProgress = mapProgress.total
    ? Math.min(100, Math.round((mapProgress.started / mapProgress.total) * 100))
    : 0

  return (
    <div className="page-stack today-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">{formatToday(now)}</p>
          <h1>{greetingFor(now)}，今天也把英语真正想起来。</h1>
          <p className="page-intro">先完成到期复习，再认识少量值得长期记住的新表达。</p>
        </div>
        <div className="weekly-callout" aria-label={`今天练过 ${stats.practicedItems} 个表达`}>
          <span className="callout-orbit"><Icon name="spark" size={17} /></span>
          <div>
            <strong>{stats.practicedItems}</strong>
            <span>今天练过的表达</span>
          </div>
        </div>
      </section>

      <section className="today-hero" aria-labelledby="today-session-title">
        <div className="hero-copy">
          <div className="session-kicker"><span /> TODAY'S RECALL</div>
          <h2 id="today-session-title">今日学习计划</h2>
          {hasTasks ? (
            <>
              <p>今日已学习 {usedMinutes} 分钟 · 按自己的节奏完成</p>
              <p>本次 {plan.totalTasks} 道练习，包含 {plan.newItemCount} 个新表达。只记录学习时间，不限时。</p>
              <div className="session-metrics">
                <div><span>复习题</span><strong>{plan.reviewTaskCount}</strong></div>
                <div><span>新表达</span><strong>{plan.newItemCount}</strong></div>
                <div><span>应用题</span><strong>{plan.usageTaskCount}</strong></div>
              </div>
            </>
          ) : (
            <>
              <p>{practicedToday ? '今天的学习计划已完成。' : '当前暂无待学内容。'}</p>
              {onStartExtra && <p>要不要再学一小组新表达？</p>}
            </>
          )}
          <div className="plan-explanation">
            <p>今日已引入 {plan.introducedToday} 个新表达 · 剩余额度 {plan.remainingNewItems} 个</p>
            {plan.overflowDueCount > 0 && <p>仍有 {plan.overflowDueCount} 道到期练习未安排</p>}
            <details><summary>为什么这样安排</summary>{plan.reasons.map((reason) => <p key={reason}>{reason}</p>)}</details>
          </div>

          {(hasTasks || onStartExtra) && (
            <div className="hero-actions">
              <button className="primary-button large" onClick={hasTasks ? onStart : onStartExtra} type="button">
                {hasTasks ? '开始今天的训练' : '再学一组'} <Icon name="arrow" size={19} />
              </button>
            </div>
          )}
        </div>

        <div className="time-orb-wrap" aria-label={hasTasks ? `预计 ${plan.estimatedMinutes} 分钟，共 ${plan.totalTasks} 道练习` : `今日已学习 ${usedMinutes} 分钟`}>
          <div className="time-orb">
            <span className="orb-small">{hasTasks ? '预计' : '今日已学'}</span>
            <strong>{hasTasks ? plan.estimatedMinutes : usedMinutes}</strong>
            <span>分钟</span>
          </div>
          <div className="orbit-dot one" />
          <div className="orbit-dot two" />
        </div>
      </section>

      <section className="panel learning-outcome" aria-labelledby="outcome-title">
        <p className="eyebrow">ONE STEP AT A TIME</p><h2 id="outcome-title">今天的收获，下一步的方向</h2>
        <p>{stats.practicedItems ? `今天已经练过 ${stats.practicedItems} 个表达。反复尝试也是学习的一部分，不必一次全答对。` : '还没有今天的练习记录。从第一小课开始，试着自己想出答案。'}</p>
        <p>{plan.reviewTaskCount > 0 ? `下一步：先完成 ${plan.reviewTaskCount} 道到期复习，把学过的再想起来。` : plan.newItemCount > 0 ? `下一步：认识 ${plan.newItemCount} 个新表达，再试着用自己的话说出来。` : '可以去口语页练一段对话，或明天回来看看新的复习。'}</p>
        {stats.retainedCount > 0 && <p>已有 {stats.retainedCount} 个表达，在间隔一段时间后仍能想起来。</p>}
      </section>

      <details className="learning-details"><summary>查看长期进度与统计依据</summary>
      <section className="dashboard-grid">
        <article className="panel progress-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LEARNING MAP</p>
              <h2>表达积累</h2>
            </div>
            <span className="subtle-badge">三条主线</span>
          </div>

          <div
            className="map-goal"
            aria-label={`学习进度：已开始 ${mapProgress.started}，双向可回忆 ${mapProgress.usable}，词库 ${mapProgress.total}`}
          >
            <div className="map-goal-copy">
              <strong>学习进度</strong>
              <span>已开始练习的表达 / 三条主线词库</span>
            </div>
            <div className="map-goal-meter">
              <div className="map-goal-numbers">
                <span>{mapProgress.started.toLocaleString('zh-CN')}</span>
                <span>/ {mapProgress.total.toLocaleString('zh-CN')}</span>
              </div>
              <div className="progress-track map-goal-track">
                <span style={{ width: `${startedProgress}%` }} />
              </div>
              <p className="map-goal-usable">
                双向可回忆 <strong>{mapProgress.usable.toLocaleString('zh-CN')}</strong>
                <span>理解意思与主动表达分别有无提示成功证据</span>
              </p>
            </div>
          </div>

          <div className="category-progress-list">
            {tracks.map((track) => {
              const progress = track.total
                ? Math.min(100, Math.round((track.learned / track.total) * 100))
                : 0
              return (
                <div className="category-progress" key={track.id}>
                  <div className={`category-icon ${track.id}`}>
                    <Icon name={track.icon} size={19} />
                  </div>
                  <div className="category-progress-main">
                    <div>
                      <div className="category-progress-label">
                        <strong>{track.label}</strong>
                        <em>{track.purpose}</em>
                      </div>
                      <span>{track.learned} / {track.total}</span>
                    </div>
                    <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="map-footnote">应用已有验证的表达 {stats.applicationCount} 个。保持与应用分别统计；词库中可展开查看依据。</p>
        </article>

        <article className="panel memory-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">MEMORY SIGNAL</p>
              <h2>记忆状态</h2>
            </div>
            <Icon name="brain" size={25} />
          </div>
          <div className="memory-score">
            <strong>{noHintRate === null ? '—' : `${noHintRate}%`}</strong>
            <span>隔一段时间，还能想起来吗？</span>
          </div>
          <p className="memory-note">
            {stats.delayedRecall.total < 10
              ? '再练几天，这里就会更有参考价值。目前可判定的复习不足 10 次，首次学习和看过提示的回答不计入。'
              : noHintRate !== null && noHintRate < 80
                ? '延迟回忆较弱，可加强复习；每日新词数量保持设置值，不自动减少。'
                : '先完成到期复习，新词约 80% 来自优先学习、20% 来自其他词库；一方不足由另一方补齐。'}
          </p>
          <p className="quiet-copy">近 7 天延迟回忆正确率：{stats.delayedRecall.correct} / {stats.delayedRecall.total} 次。即时重试与自评不计入。</p>
          <p className="quiet-copy">今日练习 {stats.practicedItems} 个表达 · {stats.taskCount} 道不同题 · {stats.attemptCount} 次作答</p>
        </article>
      </section>
      </details>

      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RECENT EXPRESSIONS</p>
            <h2>最近练过，下次试着用</h2>
          </div>
          <span className="quiet-copy">少看，多想</span>
        </div>
        {recentWords.length ? (
          <div className="recent-word-list">
            {recentWords.map((word) => (
              <div className="recent-word" key={`${word.expression}-${word.zhGloss}`}>
                <div><strong>{word.expression}</strong><span>{word.zhGloss}</span></div>
                <span className="stage-pill">{word.stage}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-inline">完成一次训练后，你最近接触的表达会出现在这里。</div>
        )}
      </section>
    </div>
  )
}
