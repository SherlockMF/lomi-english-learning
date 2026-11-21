import type { SystemListSlug } from '../domain/types'
import { ONBOARDING_CATEGORY_ORDER } from '../lib/onboarding'
import { categoryLabels } from '../lib/presentation'

interface StudyCategoryPickerProps {
  categories: readonly SystemListSlug[]
  onChange: (categories: SystemListSlug[]) => void
}

export function StudyCategoryPicker({ categories, onChange }: StudyCategoryPickerProps) {
  function toggle(slug: SystemListSlug) {
    onChange(categories.includes(slug) ? categories.filter(category => category !== slug) : [...categories, slug])
  }

  function move(index: number, offset: number) {
    const destination = index + offset
    const next = [...categories]
    next[index] = categories[destination]
    next[destination] = categories[index]
    onChange(next)
  }

  return (
    <div className="study-category-picker">
      <fieldset className="study-category-options">
        <legend>勾选想学的词库</legend>
        <div>
          {ONBOARDING_CATEGORY_ORDER.map(slug => (
            <label key={slug}>
              <input type="checkbox" checked={categories.includes(slug)} onChange={() => toggle(slug)} />
              {categoryLabels[slug]}
            </label>
          ))}
        </div>
      </fieldset>
      {categories.length > 0 ? (
        <div className="study-category-priorities">
          <strong>词库优先级</strong>
          <p className="form-note">排在前面的词库分到更多新词。</p>
          <ol aria-label="词库优先级">
            {categories.map((slug, index) => (
              <li key={slug}>
                <div className="study-category-ranked-row">
                  <span>{categoryLabels[slug]}</span>
                  <div className="study-category-move">
                    <button type="button" aria-label={`上移${categoryLabels[slug]}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                    <button type="button" aria-label={`下移${categoryLabels[slug]}`} disabled={index === categories.length - 1} onClick={() => move(index, 1)}>↓</button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : <p className="form-note">请至少选择一个词库。</p>}
    </div>
  )
}
