import { useEffect, useRef, useState } from 'react'
import { clearVoiceHistory, deleteVoiceHistory, listVoiceHistory, readVoiceHistory, type SavedVoiceTurn, type VoiceHistoryRecord, type VoiceHistorySummary } from '../lib/voice/history'
import { VOICE_SCENARIOS } from '../lib/voice/scenarios'
import type { SaveVoiceExpression } from '../lib/voice/review'
import { VoiceMessageBubble } from './VoiceMessageBubble'
import { VoiceFeedbackReview } from './VoiceFeedbackReview'
import { getDatabaseAccount } from '../lib/db'
import { VOICE_HISTORY_APPLIED } from '../lib/voice/historyCloudStorage'
import { downloadVoiceHistoryAudio } from '../lib/voice/historyTransport'

const modeName = (mode: string) => mode === 'messages' ? '语音消息' : '实时畅聊'
const scenarioName = (scenario: string) => VOICE_SCENARIOS.find(item => item.id === scenario)?.label ?? scenario
const dateLabel = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false })

function HistoryAudio({ turn, onPlay, onError }: { turn: SavedVoiceTurn; onPlay: (audio: HTMLAudioElement) => void; onError: () => void }) {
  const [url, setUrl] = useState('')
  const [blob, setBlob] = useState(turn.audio)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (!blob) return
    const next = URL.createObjectURL(blob)
    // oxlint-disable-next-line react/set-state-in-effect -- Object URLs are external resources created and released together.
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  async function download() {
    const account = getDatabaseAccount()
    if (!account || !turn.audioPath) return
    const request = new AbortController(); controller.current = request
    setLoading(true); setFailed(false)
    try { const audio = await downloadVoiceHistoryAudio(turn.audioPath, account, request.signal); if (!request.signal.aborted) setBlob(audio) }
    catch { if (!request.signal.aborted) setFailed(true) }
    finally { if (!request.signal.aborted) setLoading(false) }
  }
  return url ? <VoiceMessageBubble message={{ ...turn, audioUrl: url, duration: turn.duration ?? 0, status: turn.status === 'sending' ? 'failed' : turn.status ?? 'sent' }} onPlay={onPlay} onError={onError} />
    : <div><p>{turn.role === 'user' ? '你' : 'AI 陪练'}：{turn.text}</p>{turn.audioPath && !blob ? <button type="button" className="secondary-button" disabled={loading} onClick={() => void download()}>{loading ? '正在下载录音…' : failed ? '重试加载云端录音' : '加载云端录音'}</button> : <p>正在加载录音…</p>}{failed && <p role="alert">录音加载失败，请检查网络后重试。</p>}</div>
}

function HistoryDetail({ record, onSaveExpression }: { record: VoiceHistoryRecord; onSaveExpression?: SaveVoiceExpression }) {
  const playing = useRef<HTMLAudioElement | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => () => { playing.current?.pause() }, [])
  function download() {
    const text = [
      `Lomi English · ${modeName(record.mode)} · ${dateLabel(record.createdAt)}`,
      `${scenarioName(record.scenario)} ${record.description}`,
      ...record.turns.map(turn => `${turn.role === 'user' ? '你' : 'AI'}${!turn.final ? '（转写未完成）' : ''}${turn.interrupted ? '（被打断）' : ''}: ${turn.text}`),
      ...Object.values(record.corrections).flat().map(row => `${row.original} → ${row.improved}：${row.explanationZh}`),
      ...(record.feedback ? [record.feedback.summaryZh, ...record.feedback.corrections.map(row => `${row.original} → ${row.improved}：${row.explanationZh}`), ...record.feedback.expressions.map(row => `${row.en} — ${row.zh}`)] : []),
    ].join('\n\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `voice-history-${record.createdAt.slice(0, 10)}.txt`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <article className="voice-history-detail" aria-label="练习历史详情">
    <div className="voice-review-heading"><h3>{modeName(record.mode)} · {scenarioName(record.scenario)}</h3><button type="button" className="secondary-button" onClick={download}>下载历史文字</button></div>
    <p>{dateLabel(record.createdAt)} · {Math.floor(record.elapsedSeconds / 60)} 分 {record.elapsedSeconds % 60} 秒 · {record.difficulty === 'advanced' ? '进阶' : '基础'}</p>
    {record.description && <p>{record.description}</p>}
    <p className="voice-footnote">已保存的练习内容；未完成的转写可能不完整。{record.mode === 'realtime' ? '实时畅聊仅保存文字，没有录音。' : '点击语音条可回听。'}</p>
    <div className="voice-history-transcript">{record.turns.map(turn => <div key={turn.id}>
      {turn.audio || turn.audioPath ? <HistoryAudio turn={turn} onPlay={audio => { if (playing.current !== audio) playing.current?.pause(); playing.current = audio }} onError={() => setNotice('录音播放失败，请检查浏览器音频支持后重试。')} /> : <div className={`voice-turn voice-turn-${turn.role}`}><span>{turn.role === 'user' ? '你' : 'AI 陪练'}</span><p>{turn.text || '未收到转写'}</p>{turn.interrupted ? <small>被打断</small> : !turn.final ? <small>转写未完成</small> : null}</div>}
      {record.corrections[turn.id] && (record.corrections[turn.id].length ? <VoiceFeedbackReview feedback={{ summaryZh: '本句表达反馈', corrections: record.corrections[turn.id], expressions: [] }} onSave={onSaveExpression} /> : <p className="voice-footnote">本句未发现明显语法或用词问题</p>)}
    </div>)}</div>
    {record.feedback && <section aria-label="已保存的练习反馈"><h3>练习反馈</h3><VoiceFeedbackReview feedback={record.feedback} onSave={onSaveExpression} /></section>}
    {notice && <p role="alert">{notice}</p>}
  </article>
}

export function VoiceHistory({ onSaveExpression }: { onSaveExpression?: SaveVoiceExpression }) {
  const [records, setRecords] = useState<VoiceHistorySummary[]>([])
  const [selected, setSelected] = useState<VoiceHistoryRecord | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const managed = !!getDatabaseAccount()
  const selectedId = selected?.id
  useEffect(() => {
    const refresh = () => setReload(value => value + 1)
    window.addEventListener(VOICE_HISTORY_APPLIED, refresh)
    return () => window.removeEventListener(VOICE_HISTORY_APPLIED, refresh)
  }, [])
  useEffect(() => {
    let cancelled = false
    void Promise.all([listVoiceHistory(), selectedId ? readVoiceHistory(selectedId) : Promise.resolve(undefined)]).then(([value, detail]) => { if (!cancelled) { setRecords(value); if (selectedId) setSelected(detail ?? null); setError('') }; return undefined }, () => { if (!cancelled) setError('无法读取练习历史，请重试。') }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Explicit user retry reloads the external database.
  }, [reload, selectedId])
  async function open(id: string) {
    setBusy(true); setError('')
    try { const record = await readVoiceHistory(id); setSelected(record ?? null); if (!record) { setError('这条记录已被删除。'); setReload(value => value + 1) } }
    catch { setError('无法读取这条练习记录，请重试。') }
    finally { setBusy(false) }
  }
  async function remove(id?: string) {
    if (!window.confirm(id ? `删除这次练习的文字、反馈和录音？${managed ? '联网后同步删除云端及其他设备的记录。' : ''}删除后无法恢复。` : `清空当前账号${managed ? '全部设备及云端' : '在本机'}的全部语音练习历史？${managed ? '联网后生效。' : ''}删除后无法恢复，不影响已加入复习的词条。`)) return
    setBusy(true); setError('')
    try {
      if (id) await deleteVoiceHistory(id); else await clearVoiceHistory()
      setRecords(current => id ? current.filter(record => record.id !== id) : [])
      if (!id || selected?.id === id) setSelected(null)
    } catch { setError('删除失败，记录仍保留，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="voice-review voice-history" aria-labelledby="voice-history-title">
    <div className="voice-review-heading"><div><p className="eyebrow">PRACTICE HISTORY</p><h2 id="voice-history-title">练习历史</h2></div><button type="button" className="secondary-button" disabled={busy || (!managed && !records.length)} onClick={() => void remove()}>清空历史</button></div>
    <p className="voice-footnote">{managed ? '文字、反馈和语音消息录音会自动同步到当前账号，换设备登录后可回看；旧的本机历史也会补传。同步状态见页面顶部，失败可点「同步」重试，完成前请勿清除站点数据。云端录音按需下载，删除会同步到其他设备。' : '对话自动保存在当前浏览器，刷新后仍可回看；本地模式不上传云端，清除站点数据会一并删除。'}实时畅聊不保存录音；语音历史不包含在学习备份中。</p>
    {error && <p role="alert">{error}<button type="button" className="mini-text-button" disabled={busy} onClick={() => { setBusy(true); setReload(value => value + 1) }}>重新读取</button></p>}
    {busy && <p role="status">正在读取或更新历史…</p>}
    {!busy && !error && !records.length && <p>还没有保存的语音练习。开始一次对话，有内容后会自动保存。</p>}
    <ul className="voice-history-list">{records.map(record => <li key={record.id}>
      <button type="button" className="voice-history-open" disabled={busy} aria-label={`回看练习 ${dateLabel(record.createdAt)} ${modeName(record.mode)}`} aria-pressed={selected?.id === record.id} onClick={() => void open(record.id)}><strong>{modeName(record.mode)} · {scenarioName(record.scenario)}</strong><span>{dateLabel(record.createdAt)} · {record.turnCount} 条发言</span>{record.description && <span>{record.description}</span>}</button>
      <button type="button" className="mini-text-button" disabled={busy} aria-label={`删除练习 ${dateLabel(record.createdAt)} ${modeName(record.mode)}`} onClick={() => void remove(record.id)}>删除</button>
    </li>)}</ul>
    {selected && <><button className="mini-text-button" type="button" onClick={() => setSelected(null)}>收起历史详情</button><HistoryDetail key={selected.id} record={selected} onSaveExpression={onSaveExpression} /></>}
  </section>
}
