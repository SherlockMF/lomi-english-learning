import { useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { VocabularyItem } from '../domain/types'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { useFocusTrap } from '../lib/useFocusTrap'
import { replaceCorrectedExpression, reviseCorrectionExample, type WordCorrection } from '../lib/wordCorrection'
import { Icon } from './Icon'

interface WordCorrectionDialogProps {
  item: VocabularyItem
  onClose: () => void
  onSave: (correction: WordCorrection) => Promise<void>
}

export function WordCorrectionDialog({ item, onClose, onSave }: WordCorrectionDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const [expression, setExpression] = useState(item.expression)
  const [zhGloss, setZhGloss] = useState(item.zhGloss)
  const [editedDefinition, setEditedDefinition] = useState<string>()
  const [editedExampleEn, setEditedExampleEn] = useState<string>()
  const [editedExampleZh, setEditedExampleZh] = useState<string>()
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const oldExample = item.examples[0] ?? { en: '', zh: '' }
  const revised = reviseCorrectionExample(oldExample, item, expression.trim(), zhGloss.trim())
  const enDefinition = editedDefinition ?? replaceCorrectedExpression(item.enDefinition, item.expression, expression.trim())
  const example = { en: (editedExampleEn ?? revised.en).trim(), zh: (editedExampleZh ?? revised.zh).trim() }
  const changed = expression.trim() !== item.expression || zhGloss.trim() !== item.zhGloss
    || enDefinition.trim() !== item.enDefinition || example.en !== oldExample.en || example.zh !== oldExample.zh
  const canSave = expression.trim() && zhGloss.trim() && changed && !saving
  const close = () => { if (!saving) onClose() }

  useEscapeToClose(close)
  useFocusTrap(dialogRef)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) return
    setSaveError('')
    setSaving(true)
    try {
      await onSave({ expression: expression.trim(), zhGloss: zhGloss.trim(), enDefinition: enDefinition.trim(), example })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存修正失败，请重试。')
      setSaving(false)
    }
  }

  return createPortal(
    <div className="dialog-backdrop study-correction-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close()
    }}>
      <section ref={dialogRef} className="dialog-card study-correction-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-heading">
          <div><h2 id={titleId}>纠正词条</h2><p>保存后用修正内容重新出题，已有学习进度会保留。</p></div>
          <button className="icon-button" aria-label="关闭纠错" type="button" onClick={close} disabled={saving}><Icon name="close" size={20} /></button>
        </div>
        <form onSubmit={submit}>
          <fieldset className="word-form study-correction-fields" disabled={saving}>
            <label><span>英文表达</span><input lang="en" value={expression} onChange={event => setExpression(event.target.value)} required /></label>
            <label><span>中文意思</span><input value={zhGloss} onChange={event => setZhGloss(event.target.value)} required /></label>
            <details className="study-correction-context">
              <summary>核对英文定义和例句</summary>
              <label><span>英文定义</span><textarea lang="en" value={enDefinition} onChange={event => setEditedDefinition(event.target.value)} rows={2} /></label>
              <label><span>英文例句</span><textarea lang="en" value={editedExampleEn ?? revised.en} onChange={event => setEditedExampleEn(event.target.value)} rows={2} /></label>
              <label><span>例句中文</span><textarea value={editedExampleZh ?? revised.zh} onChange={event => setEditedExampleZh(event.target.value)} rows={2} /></label>
            </details>
          </fieldset>
          {saveError && <p className="form-note" role="alert">{saveError}</p>}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={close} disabled={saving}>取消</button>
            <button className="primary-button" type="submit" disabled={!canSave}>{saving ? '正在保存…' : '保存修正'}</button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}
