import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SYSTEM_LIST_ORDER, VOCABULARY_LEVELS, type SystemListSlug, type VocabularyItem, type VocabularyLevel } from '../domain/types'
import { getVocabularyDifficulty, vocabularyLevelLabels } from '../lib/studyDifficulty'
import { type EditCategory } from '../lib/listMembership'
import { categoryLabels } from '../lib/presentation'
import type { LearningEvidence } from '../lib/learningEvidence'
import { splitListValues } from '../lib/text'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { useFocusTrap } from '../lib/useFocusTrap'
import { WordEntryDialog } from './WordEntryDialog'
import { Icon } from './Icon'
import { expressionKey, groupWordsByExpression } from '../lib/wordSenses'

type LibraryFilter = 'all' | 'my-vocabulary' | SystemListSlug
type VocabularyEditPatch = Pick<
  VocabularyItem,
  'zhGloss' | 'enDefinition' | 'partOfSpeech' | 'examples' | 'collocations'
> & { category: EditCategory; scenarioNote?: string; vocabularyLevel?: VocabularyLevel; expectedWord?: VocabularyItem }

interface LibraryViewProps {
  onRequestLogin?: () => void
  items: VocabularyItem[]
  evidenceByItemId: ReadonlyMap<string, LearningEvidence>
  onToggleStatus: (item: VocabularyItem) => Promise<void>
  onToggleKnown: (item: VocabularyItem) => Promise<void>
  onUpdate: (
    id: string,
    patch: VocabularyEditPatch,
  ) => Promise<void>
  onAddToMyVocabulary: (item: VocabularyItem) => Promise<{ ok: boolean; message: string }>
  onRemoveFromMyVocabulary: (item: VocabularyItem) => Promise<{ ok: boolean; message: string }>
  onCompleteSenses?: (item: VocabularyItem) => Promise<{ message: string }>
}

const filters: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'daily', label: '日常生活' },
  { id: 'business', label: '商业英语' },
  { id: 'finance', label: '金融英语' },
  { id: 'accounting', label: '会计英语' },
  { id: 'my-vocabulary', label: '优先学习' },
]

const expansionCategories = SYSTEM_LIST_ORDER.filter((slug) => !filters.some((item) => item.id === slug))

export function LibraryView({
  items,
  evidenceByItemId,
  onToggleStatus,
  onToggleKnown,
  onUpdate,
  onAddToMyVocabulary,
  onRemoveFromMyVocabulary,
  onCompleteSenses,
  onRequestLogin,
}: LibraryViewProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [levelFilter, setLevelFilter] = useState<VocabularyLevel | 'all'>('all')
  const [knowledgeFilter, setKnowledgeFilter] = useState('all')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedSenses, setSelectedSenses] = useState<Record<string, string>>({})
  const [visibleCount, setVisibleCount] = useState(24)
  const [editing, setEditing] = useState<{ item: VocabularyItem } | null>(null)
  const entryTrigger = useRef<HTMLElement | null>(null)
  const entryFallback = useRef<HTMLElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const availableExpansionCategories = useMemo(() => {
    const availableLists = new Set(items.flatMap((item) => item.listSlugs))
    return expansionCategories.filter((slug) => availableLists.has(slug))
  }, [items])
  const isExpansionFilter = availableExpansionCategories.some((slug) => slug === filter)
  const activeFilter = isExpansionFilter || filters.some((item) => item.id === filter) ? filter : 'all'

  useEffect(() => setVisibleCount(24), [query, activeFilter, levelFilter, knowledgeFilter])

  const filtered = useMemo(() => {
    const cleaned = query.trim().toLocaleLowerCase()
    return items
      .filter((item) => {
        if (activeFilter !== 'all' && !item.listSlugs.includes(activeFilter)) return false
        if (levelFilter !== 'all' && getVocabularyDifficulty(item).level !== levelFilter) return false
        if (knowledgeFilter === 'known' && !item.knownAt || knowledgeFilter === 'learning' && item.knownAt) return false
        if (!cleaned) return true
        return [item.expression, item.zhGloss, item.enDefinition, ...item.collocations]
          .some((value) => value.toLocaleLowerCase().includes(cleaned))
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1
        if (a.listSlugs.includes('my-vocabulary') !== b.listSlugs.includes('my-vocabulary')) {
          return a.listSlugs.includes('my-vocabulary') ? -1 : 1
        }
        return a.expression.localeCompare(b.expression) || a.id.localeCompare(b.id)
      })
  }, [activeFilter, items, query, levelFilter, knowledgeFilter])
  const entries = useMemo(() => groupWordsByExpression(filtered), [filtered])
  const completeEntries = useMemo(() => new Map(groupWordsByExpression(items).map((entry) => [entry.key, entry])), [items])
  const selectedItem = items.find((item) => item.id === selectedItemId)
  const selectedKey = selectedItem ? expressionKey(selectedItem.expression) : undefined
  const selectedEntry = selectedKey ? completeEntries.get(selectedKey) : undefined

  function selectSense(id: string) {
    setSelectedItemId(id)
    const item = items.find((candidate) => candidate.id === id)
    if (item) setSelectedSenses((previous) => ({ ...previous, [expressionKey(item.expression)]: id }))
  }

  function openSense(id: string) {
    entryTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    entryFallback.current = entryTrigger.current?.closest('article')?.querySelector<HTMLElement>('.compact-word-expression') ?? null
    selectSense(id)
  }

  function closeEntry() {
    setSelectedItemId(null)
    const target = entryTrigger.current?.isConnected ? entryTrigger.current
      : entryFallback.current?.isConnected ? entryFallback.current : searchInput.current
    target?.focus()
  }

  return (
    <div className="page-stack library-page">
      <section className="page-header library-header">
        <div>
          <p className="eyebrow">YOUR LANGUAGE BANK</p>
          <h1>词库</h1>
          <p className="page-intro">同词归并，义项分别学习。点击词义查看例句与学习情况。</p>
        </div>
        <div className="library-total"><strong>{items.length}</strong><span>个独立义项</span></div>
      </section>

      <section className="library-tools" aria-label="词库筛选">
        <div className="input-with-icon library-search">
          <Icon name="search" size={19} />
          <input ref={searchInput} aria-label="搜索词库" onChange={(event) => setQuery(event.target.value)} placeholder="搜索英文、中文或搭配" value={query} />
        </div>
        <div className="filter-pills">
          {filters.map((item) => (
            <button className={activeFilter === item.id ? 'active' : ''} key={item.id} onClick={() => setFilter(item.id)} type="button">
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <div className="difficulty-filters">
        {availableExpansionCategories.length > 0 ? (
          <label>扩展词库分类
            <select value={isExpansionFilter ? activeFilter : 'all'} onChange={(event) => setFilter(event.target.value as LibraryFilter)}>
              <option value="all">选择分类</option>
              {availableExpansionCategories.map((slug) => <option key={slug} value={slug}>{categoryLabels[slug]}</option>)}
            </select>
          </label>
        ) : null}
        <label>词汇难度 <select aria-label="筛选词汇难度" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value as VocabularyLevel | 'all')}><option value="all">全部等级</option>{VOCABULARY_LEVELS.map((level) => <option key={level} value={level}>{vocabularyLevelLabels[level]}</option>)}</select></label>
        <label>学习状态 <select aria-label="筛选学习状态" value={knowledgeFilter} onChange={(event) => setKnowledgeFilter(event.target.value)}><option value="all">全部状态</option><option value="learning">待学习</option><option value="known">已会</option></select></label>
      </div>
      <div className="library-result-line">
        <span>找到 {entries.length} 个词条 · {filtered.length} 个义项</span>
        <span>已会或暂停的内容不会进入每日训练</span>
      </div>
      {filter === 'my-vocabulary' && <p className="form-note">每日新词约 80% 来自优先学习，约 20% 来自其他词库，四舍五入；一方不足由另一方补齐。普通词分类跨天累计，在相近难度下按日常、商业、金融、会计 4:3:2:1 加权选取，不每天重置。训练先完成优先词，再学习普通词；暂停的词不参与安排。</p>}

      {filtered.length ? (
        <>
          <section className="word-card-grid">
            {entries.slice(0, visibleCount).map((entry) => {
              const selected = entry.senses.find((sense) => sense.id === selectedSenses[entry.key]) ?? entry.senses[0]
              const preview = entry.senses.slice(0, 3)
              if (!preview.some((sense) => sense.id === selected.id)) preview[2] = selected
              const evidence = evidenceByItemId.get(selected.id)
              const senseCount = completeEntries.get(entry.key)!.senses.length
              return (
                <article className="word-card compact-word-card" key={entry.key}>
                  <div className="compact-word-body">
                    <button className="compact-word-expression" type="button" aria-label={`查看 ${entry.expression} 的详情`} onClick={() => openSense(selected.id)}>
                      <h2>{entry.expression}</h2>
                      <span>{getVocabularyDifficulty(selected).level} · {categoryLabels[selected.category]}</span>
                    </button>
                    <div className="compact-word-senses" aria-label={`${entry.expression} 的义项预览`}>
                      {preview.map((sense) => (
                        <button key={sense.id} type="button" aria-label={`查看 ${entry.expression}：${sense.zhGloss || sense.enDefinition || '待补充词义'}`}
                          aria-pressed={sense.id === selected.id} title={`${sense.partOfSpeech} · ${sense.zhGloss || sense.enDefinition}`}
                          onClick={() => openSense(sense.id)}>
                          <span className="compact-sense-dot" aria-hidden="true" /><span>{sense.zhGloss || '待补充中文'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="compact-word-footer">
                    <span title={selected.zhGloss || selected.enDefinition}>{selected.knownAt ? '已会（自报）' : selected.status === 'paused' ? '已暂停' : evidence?.label ?? '未开始'}</span>
                    <button type="button" onClick={() => openSense(selected.id)} aria-label={`查看 ${entry.expression} 全部 ${senseCount} 个义项`}>
                      {senseCount > 3 ? `全部 ${senseCount} 义项` : `${senseCount} 义项`}<Icon name="arrow" size={13} />
                    </button>
                  </div>
                </article>
              )
            })}
          </section>
          {visibleCount < entries.length && (
            <button className="load-more-button" onClick={() => setVisibleCount((count) => count + 24)} type="button">
              显示更多 <Icon name="chevron" size={17} />
            </button>
          )}
        </>
      ) : (
        <div className="empty-state panel">
          <span><Icon name="search" size={25} /></span>
          <h2>没有找到对应的表达</h2>
          <p>换一个关键词或分类试试。</p>
        </div>
      )}

      {selectedEntry && selectedItem && !editing && (
        <WordEntryDialog entry={selectedEntry} item={selectedItem} evidenceByItemId={evidenceByItemId}
          onRequestLogin={onRequestLogin ? () => { closeEntry(); onRequestLogin() } : undefined}
          onSelectSense={selectSense} onEdit={(item) => setEditing({ item })}
          onClose={closeEntry}
          onToggleStatus={onToggleStatus} onToggleKnown={onToggleKnown}
          onAddToMyVocabulary={onAddToMyVocabulary} onRemoveFromMyVocabulary={onRemoveFromMyVocabulary}
          onCompleteSenses={onCompleteSenses} />
      )}
      {editing && (
        <EditWordDialog
          item={editing.item}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await onUpdate(editing.item.id, { ...patch, expectedWord: editing.item })
            setEditing((current) => current === editing ? null : current)
          }}
        />
      )}
    </div>
  )
}

interface EditWordDialogProps {
  item: VocabularyItem
  onClose: () => void
  onSave: (patch: VocabularyEditPatch) => Promise<void>
}

function EditWordDialog({ item, onClose, onSave }: EditWordDialogProps) {
  const [zhGloss, setZhGloss] = useState(item.zhGloss)
  const [enDefinition, setEnDefinition] = useState(item.enDefinition)
  const [partOfSpeech, setPartOfSpeech] = useState(item.partOfSpeech)
  const [exampleEn, setExampleEn] = useState(item.examples[0]?.en ?? '')
  const [exampleZh, setExampleZh] = useState(item.examples[0]?.zh ?? '')
  const [collocations, setCollocations] = useState(item.collocations.join(', '))
  const [category, setCategory] = useState<EditCategory>(
    item.category === 'my-vocabulary' ? 'other' : item.category,
  )
  const [scenarioNote, setScenarioNote] = useState(item.scenarioNote ?? '')
  const [vocabularyLevel, setVocabularyLevel] = useState<VocabularyLevel | ''>(item.vocabularyLevel ?? '')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)

  useEscapeToClose(onClose)
  useFocusTrap(dialogRef)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const dialog = (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section ref={dialogRef} aria-labelledby="edit-word-title" aria-modal="true" className="dialog-card edit-dialog" role="dialog">
        <div className="dialog-heading">
          <div><p className="eyebrow">EDIT ONE SENSE</p><h2 id="edit-word-title">编辑 {item.expression}</h2></div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button"><Icon name="close" size={20} /></button>
        </div>
        <div className="word-form">
          <label><span>当前义项难度</span><select aria-label="词汇难度" value={vocabularyLevel} onChange={(event) => setVocabularyLevel(event.target.value as VocabularyLevel | '')}><option value="">使用词头参考或估算</option>{VOCABULARY_LEVELS.map((level) => <option key={level} value={level}>{vocabularyLevelLabels[level]}</option>)}</select></label>
          <div className="form-grid two-columns">
            <label><span>中文义项</span><input onChange={(event) => setZhGloss(event.target.value)} value={zhGloss} /></label>
            <label><span>词性</span><input onChange={(event) => setPartOfSpeech(event.target.value)} value={partOfSpeech} /></label>
          </div>
          <label><span>英文定义</span><textarea onChange={(event) => setEnDefinition(event.target.value)} rows={2} value={enDefinition} /></label>
          <div className="form-grid two-columns">
            <label><span>英文例句</span><textarea onChange={(event) => setExampleEn(event.target.value)} rows={3} value={exampleEn} /></label>
            <label><span>例句中文</span><textarea onChange={(event) => setExampleZh(event.target.value)} rows={3} value={exampleZh} /></label>
          </div>
          <label><span>常用搭配</span><input onChange={(event) => setCollocations(event.target.value)} value={collocations} /></label>
          <label><span>使用场景</span><select onChange={(event) => setCategory(event.target.value as EditCategory)} value={category}>
            {SYSTEM_LIST_ORDER.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
            <option value="other">{categoryLabels.other}</option>
          </select></label>
          {category === 'other' && (
            <label>
              <span>自定义场景备注</span>
              <input
                onChange={(event) => setScenarioNote(event.target.value)}
                placeholder="例如：宿舍、社团、兼职"
                value={scenarioNote}
              />
            </label>
          )}
          {saveError && <p className="form-note" role="alert">{saveError}</p>}
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">取消</button>
          <button
            className="primary-button"
            disabled={!zhGloss.trim() || saving || (category === 'other' && !scenarioNote.trim())}
            onClick={async () => {
              if (category === 'other' && !scenarioNote.trim()) {
                setSaveError('选择「其他」时，请填写自定义场景备注。')
                return
              }
              setSaving(true)
              setSaveError('')
              try {
                await onSave({
                  zhGloss: zhGloss.trim(),
                  vocabularyLevel: vocabularyLevel || undefined,
                  enDefinition: enDefinition.trim(),
                  partOfSpeech: partOfSpeech.trim() || 'expression',
                  examples: [...(exampleEn.trim() ? [{ en: exampleEn.trim(), zh: exampleZh.trim() }] : []), ...item.examples.slice(1)],
                  collocations: splitListValues(collocations),
                  category,
                  scenarioNote: category === 'other' ? scenarioNote.trim() : undefined,
                })
              } catch (error) {
                setSaveError(error instanceof Error ? error.message : '保存失败，请重试。')
              } finally {
                setSaving(false)
              }
            }}
            type="button"
          >
            保存修改
          </button>
        </div>
      </section>
    </div>
  )

  return createPortal(dialog, document.body)
}
