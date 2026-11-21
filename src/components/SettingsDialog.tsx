import { useEffect, useRef, useState } from 'react'
import { VOCABULARY_LEVELS, type SpeechAccent, type UserSettings, type VocabularyLevel } from '../domain/types'
import { vocabularyLevelLabels } from '../lib/studyDifficulty'
import {
  clearDeepseekApiKey,
  getDeepseekApiKey,
  setDeepseekApiKey,
} from '../lib/llm/config'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { useFocusTrap } from '../lib/useFocusTrap'
import { Icon } from './Icon'
import { VoiceServiceStatus } from './VoiceServiceStatus'
import { KeyStatusBadge } from './KeyStatusBadge'
import { isCloudEnabled } from '../lib/cloud/config'
import { AccountDataSection, type AccountControls } from './AccountDataSection'

interface SettingsDialogProps {
  account?: AccountControls
  onClearLocal?: () => Promise<void>
  onOpenOnboarding?: () => void
  onRequestLogin?: () => void
  settings: UserSettings
  vocabularyCount: number
  attemptCount: number
  onClose: () => void
  onSave: (settings: UserSettings) => Promise<void>
  onExport: () => Promise<void>
  onImport: (content: string) => Promise<{ ok: boolean; message: string }>
  onExportVocabulary: () => Promise<void>
  onImportVocabulary: (content: string) => Promise<{ ok: boolean; message: string }>
}

export function SettingsDialog({
  settings,
  vocabularyCount,
  attemptCount,
  onClose,
  onSave,
  onExport,
  onImport,
  onExportVocabulary,
  onImportVocabulary,
  onRequestLogin,
  account,
  onClearLocal,
  onOpenOnboarding,
}: SettingsDialogProps) {
  const managed = Boolean(onRequestLogin || account) || isCloudEnabled()
  const [newItems, setNewItems] = useState(String(settings.newItemsPerDay))
  const [speechAccent, setSpeechAccent] = useState<SpeechAccent>(settings.speechAccent)
  const [vocabularyLevel, setVocabularyLevel] = useState<VocabularyLevel>(settings.vocabularyLevel ?? 'B1')
  const [adaptiveDifficulty, setAdaptiveDifficulty] = useState(settings.adaptiveDifficulty !== false)
  const [savedApiKey, setSavedApiKey] = useState(() => onRequestLogin ? '' : getDeepseekApiKey())
  const [apiKey, setApiKey] = useState(savedApiKey)
  const [apiKeyNotice, setApiKeyNotice] = useState('')
  const [apiKeyFailed, setApiKeyFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [persistentState, setPersistentState] = useState<'idle' | 'granted' | 'unavailable'>('idle')
  const backupFileRef = useRef<HTMLInputElement>(null)
  const vocabularyFileRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEscapeToClose(() => {
    if (!backupBusy && !saving) onClose()
  })
  useFocusTrap(dialogRef)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    setNewItems(String(settings.newItemsPerDay))
    setSpeechAccent(settings.speechAccent)
    setVocabularyLevel(settings.vocabularyLevel ?? 'B1')
    setAdaptiveDifficulty(settings.adaptiveDifficulty !== false)
  }, [settings.newItemsPerDay, settings.speechAccent, settings.vocabularyLevel, settings.adaptiveDifficulty])

  async function runBackupAction(action: () => Promise<void>) {
    if (onRequestLogin) { onRequestLogin(); return }
    setBackupBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败，请重试。')
    } finally {
      setBackupBusy(false)
    }
  }

  async function importFromFile(file: File, importAction: (content: string) => Promise<{ ok: boolean; message: string }>) {
    if (onRequestLogin) { onRequestLogin(); return }
    setBackupBusy(true)
    setMessage('')
    try {
      const result = await importAction(await file.text())
      setMessage(result.message)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败，请重试。')
    } finally {
      setBackupBusy(false)
    }
  }

  async function requestPersistentStorage() {
    if (onRequestLogin) { onRequestLogin(); return }
    if (!navigator.storage?.persist) {
      setPersistentState('unavailable')
      return
    }
    const granted = await navigator.storage.persist()
    setPersistentState(granted ? 'granted' : 'unavailable')
  }

  function saveDeepseekKey(value: string): boolean {
    const cleaned = value.trim()
    try {
      if (cleaned) setDeepseekApiKey(cleaned)
      else clearDeepseekApiKey()
      if (getDeepseekApiKey() !== cleaned) throw new Error('Key storage verification failed')
      setSavedApiKey(cleaned)
      setApiKeyFailed(false)
      setApiKeyNotice(cleaned ? '已保存 DeepSeek API Key。' : '已清除 DeepSeek API Key。')
      return true
    } catch {
      setApiKeyFailed(true)
      setApiKeyNotice('无法更新 DeepSeek Key，请检查浏览器存储权限后重试。')
      return false
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section ref={dialogRef} aria-labelledby="settings-title" aria-modal="true" className="dialog-card settings-dialog" role="dialog">
        <div className="dialog-heading">
          <div><p className="eyebrow">{managed ? 'PRIVATE ACCOUNT' : 'LOCAL & PRIVATE'}</p><h2 id="settings-title">学习设置</h2></div>
          <button aria-label="关闭设置" className="icon-button" onClick={onClose} type="button"><Icon name="close" size={20} /></button>
        </div>

        <AccountDataSection managed={managed} account={account} onRequestLogin={onRequestLogin} onClearLocal={onClearLocal} />
        {onOpenOnboarding && <div className="settings-section"><h3>开始引导</h3><p>重新选择目标、难度和学习节奏，不会清除已有学习记录。</p><button type="button" className="secondary-button" onClick={onOpenOnboarding}>重新打开使用引导</button></div>}

        <div className="settings-section">
          <div className="settings-copy">
            <h3>每日节奏</h3>
            <p>每日新表达按个人优先学习清单约 80%、所选词库约 20% 分配，一方不足由另一方补齐。可以分多次完成。</p>
          </div>
          <label className="text-setting">
            <span>每日新表达数量 <small>0—100 个；0 表示只复习</small></span>
            <input aria-label="每日新表达数量" type="number" min="0" max="100" step="1" value={newItems} onChange={(event) => setNewItems(event.target.value)} />
          </label>
          <div className="retention-setting">
            <span><Icon name="brain" size={20} /></span>
            <div><strong>目标保持率 {Math.round(settings.desiredRetention * 100)}%</strong><p>这是 FSRS 安排复习的目标，不代表已经达到的掌握程度。</p></div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-copy">
            <h3>词汇难度</h3>
            <p>各词库优先选取目标等级，同级不足时补充相邻等级。新词按所选词库的优先级跨天分配，可到「词库」调整。修改等级或开关后重新累计表现。</p>
          </div>
          <label className="text-setting"><span>起始词汇难度</span><select aria-label="起始词汇难度" value={vocabularyLevel} onChange={(event) => setVocabularyLevel(event.target.value as VocabularyLevel)}>
            {VOCABULARY_LEVELS.map((level) => <option key={level} value={level}>{vocabularyLevelLabels[level]}</option>)}
          </select></label>
          <label className="text-setting"><span>根据学习表现自动调整</span><input aria-label="根据学习表现自动调整" type="checkbox" checked={adaptiveDifficulty} onChange={(event) => setAdaptiveDifficulty(event.target.checked)} /></label>
          <p className="form-note">连续 3 个普通新词双向快速、无提示答对，升一级；连续 2 个词首轮答错、想不起来或依赖二级以上提示，降一级。已会可在词库或训练中标记并跳过。词级来自 CEFR-J / Octanove，未收录为估算，不能代替水平测评。</p>
          <p className="form-note"><a href="https://github.com/openlanguageprofiles/olp-en-cefrj" target="_blank" rel="noreferrer">词级来源与使用条件</a> · CEFR-J © Tono Laboratory, TUFS；Octanove C1/C2：CC BY-SA 4.0</p>
        </div>

        <div className="settings-section">
          <div className="settings-copy">
            <h3>发音口音</h3>
            <p>练习反馈与「再听一次」默认使用的口音。词库页仍可临时切换 UK / US。</p>
          </div>
          <div className="accent-toggle" role="group" aria-label="默认发音口音">
            <button
              aria-pressed={speechAccent === 'uk'}
              className={`mini-text-button${speechAccent === 'uk' ? ' is-active' : ''}`}
              onClick={() => setSpeechAccent('uk')}
              type="button"
            >
              UK 英式
            </button>
            <button
              aria-pressed={speechAccent === 'us'}
              className={`mini-text-button${speechAccent === 'us' ? ' is-active' : ''}`}
              onClick={() => setSpeechAccent('us')}
              type="button"
            >
              US 美式
            </button>
          </div>
        </div>

        {managed ? <div className="settings-section"><div className="settings-copy"><h3>DeepSeek 辅助</h3><p>由管理员提供，用于判分、提示和词条补全。是否可用及剩余额度以实际调用结果为准。</p></div></div> : <div className="settings-section">
          <div className="settings-copy">
            <div className="settings-service-heading"><h3>DeepSeek 辅助</h3><KeyStatusBadge service="DeepSeek" status={apiKeyFailed ? 'error' : apiKey.trim() !== savedApiKey ? 'pending' : savedApiKey ? 'saved' : 'missing'} /></div>
            <p>可选。用于语义判分、提示、造题与词条补全；开放造句需主动点击 AI 验证。Key 只存在本机，不会进入备份；未验证的造句不会计为已通过。</p>
          </div>
          <label className="text-setting">
            <span>API Key</span>
            <input
              aria-label="DeepSeek API Key"
              autoComplete="off"
              onChange={(event) => { setApiKey(event.target.value); setApiKeyFailed(false); setApiKeyNotice('') }}
              placeholder="sk-..."
              type="password"
              value={apiKey}
            />
          </label>
          <div className="backup-actions">
            <button className="primary-button" disabled={saving || !apiKey.trim()} onClick={() => saveDeepseekKey(apiKey)} type="button">保存 DeepSeek Key</button>
            <button className="secondary-button" disabled={saving} onClick={() => { if (saveDeepseekKey('')) setApiKey('') }} type="button">清除 API Key</button>
          </div>
          {apiKeyNotice && <p className="key-status-help" role={apiKeyFailed ? 'alert' : 'status'}>{apiKeyNotice}</p>}
          <p className="key-status-help">点击「保存 DeepSeek Key」后立即生效，不需要保存其他设置。已保存仅表示保留在本机；接口是否可用以实际调用结果为准。</p>
        </div>}

        {onRequestLogin ? <div className="settings-section"><div className="settings-copy"><h3>千问口语陪练</h3><p>可先浏览场景和难度，开始练习时再登录。</p></div></div> : <VoiceServiceStatus />}

        <div className="settings-section">
          <div className="settings-copy">
            <h3>词库</h3>
            <p>导出/导入全部义项（内置种子 + 词典/手动录入）及分类归属。导入为合并，不覆盖学习进度。</p>
          </div>
          <div className="backup-actions">
            <button className="secondary-button" disabled={backupBusy} onClick={() => void runBackupAction(onExportVocabulary)} type="button"><Icon name="download" size={18} /> 导出词库</button>
            <button className="secondary-button" disabled={backupBusy} onClick={() => { if (onRequestLogin) onRequestLogin(); else vocabularyFileRef.current?.click() }} type="button"><Icon name="upload" size={18} /> 导入词库</button>
            <input
              accept="application/json,.json"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (!window.confirm('导入词库会合并到当前词库，不会替换学习进度。确认继续吗？')) return
                await importFromFile(file, onImportVocabulary)
              }}
              ref={vocabularyFileRef}
              type="file"
            />
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-copy">
            <h3>学习备份</h3>
            <p>{vocabularyCount} 个义项 · {attemptCount} 次作答。导出含词条、进度、证据、学习计时与设置；导入会整库替换。{managed ? '当前账号的本机缓存会同步到云端；导入后的替换也会同步，请先导出原数据。' : '数据只保存在这个浏览器中。'}</p>
          </div>
          <div className="backup-actions">
            <button className="secondary-button" disabled={backupBusy} onClick={() => void runBackupAction(onExport)} type="button"><Icon name="download" size={18} /> 导出学习备份</button>
            <button className="secondary-button" disabled={backupBusy} onClick={() => { if (onRequestLogin) onRequestLogin(); else backupFileRef.current?.click() }} type="button"><Icon name="upload" size={18} /> 导入学习备份</button>
            <input
              accept="application/json,.json"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (!window.confirm(managed ? '导入会替换当前账号的学习数据，并同步到其他设备。请先导出原数据备份。确认继续吗？' : '导入会用备份中的进度替换当前本地数据。确认继续吗？')) return
                await importFromFile(file, onImport)
              }}
              ref={backupFileRef}
              type="file"
            />
          </div>
          <button className="storage-persist-button" onClick={() => void requestPersistentStorage()} type="button">
            <Icon name="check" size={17} />
            {persistentState === 'granted'
              ? '浏览器已允许持久保存'
              : persistentState === 'unavailable'
                ? '浏览器未授予持久保存，请定期导出'
                : '请求浏览器持久保存本地数据'}
          </button>
        </div>

        {message && <div className="inline-alert">{message}</div>}

        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">取消</button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={async () => {
              if (onRequestLogin) { onRequestLogin(); return }
              const limit = Number(newItems)
              if (!newItems.trim() || !Number.isInteger(limit) || limit < 0 || limit > 100) {
                setMessage('新表达数量须为 0—100 的整数。')
                return
              }
              setSaving(true)
              setMessage('')
              try {
                if (!managed && !saveDeepseekKey(apiKey)) { setMessage('无法更新 DeepSeek Key，请检查浏览器存储权限后重试。'); return }
                await onSave({ ...settings, newItemsPerDay: limit, speechAccent, vocabularyLevel, adaptiveDifficulty,
                  difficultyResetAt: vocabularyLevel !== (settings.vocabularyLevel ?? 'B1') || adaptiveDifficulty !== (settings.adaptiveDifficulty !== false) ? new Date().toISOString() : settings.difficultyResetAt })
                onClose()
              } catch (error) {
                setMessage(error instanceof Error ? error.message : '保存设置失败，请重试。')
              } finally {
                setSaving(false)
              }
            }}
            type="button"
          >
            保存设置
          </button>
        </div>
      </section>
    </div>
  )
}
