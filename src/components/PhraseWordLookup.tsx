import { Fragment, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import phraseWordDictionary from '../data/phraseWordDictionary.json'
import type { VocabularyItem } from '../domain/types'
import { englishWordTokens, phraseWordKey, phraseWordTokens } from '../lib/phraseWordTokens'
import { speakWord } from '../lib/speech'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { useFocusTrap } from '../lib/useFocusTrap'
import { Icon } from './Icon'

interface PhraseWordEntry {
  glosses: string[]
  uk?: string
  us?: string
  ipa?: string
}

const dictionary: Record<string, PhraseWordEntry> = phraseWordDictionary

function findBundledWord(key: string) {
  return Object.hasOwn(dictionary, key) ? dictionary[key] : undefined
}

function printIpa(ipa: string) {
  return ipa.startsWith('/') ? ipa : `/${ipa}/`
}

export function PhraseWordLookup({ expression, items, as: Element = 'h1' }: { expression: string; items: VocabularyItem[]; as?: 'h1' | 'p' }) {
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const isExample = Element === 'p'
  const tokens = isExample ? englishWordTokens(expression) : phraseWordTokens(expression)
  if (!tokens.length) return <Element>{expression}</Element>

  return <>
    <Element aria-label={isExample ? undefined : expression} lang="en">
      {tokens.map(({ word, start, end }, index) => <Fragment key={start}>
        {expression.slice(tokens[index - 1]?.end ?? 0, start)}
        <button type="button" className={isExample ? 'phrase-word-button example-word-button' : 'phrase-word-button'} aria-label={`查词 ${word}`} aria-haspopup="dialog"
          onClick={() => setSelectedWord(word)}>{word}</button>
        {index === tokens.length - 1 && expression.slice(end)}
      </Fragment>)}
    </Element>
    {selectedWord && <PhraseWordDialog word={selectedWord} items={items} onClose={() => setSelectedWord(null)} />}
  </>
}

function PhraseWordDialog({ word, items, onClose }: { word: string; items: VocabularyItem[]; onClose: () => void }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  useEscapeToClose(onClose)
  useFocusTrap(dialogRef)

  const key = phraseWordKey(word)
  const local = items.filter(item => phraseWordKey(item.expression) === key)
  const bundled = findBundledWord(key) ?? findBundledWord(key.toLowerCase())
  const glosses = [...new Set([
    ...local.map(item => item.zhGloss || item.enDefinition).filter(Boolean),
    ...(bundled?.glosses ?? []),
  ])].slice(0, 4)
  const components = glosses.length === 0 && key.includes('-')
    ? key.split('-').flatMap(part => {
      const gloss = findBundledWord(part)?.glosses[0]
      return gloss ? [part + ' · ' + gloss] : []
    }) : []
  const uk = local.find(item => item.ipaUk)?.ipaUk || bundled?.uk
  const us = local.find(item => item.ipaUs)?.ipaUs || bundled?.us
  const pronunciation = { expression: word, audioUk: local.find(item => item.audioUk)?.audioUk, audioUs: local.find(item => item.audioUs)?.audioUs }

  return createPortal(
    <div className="dialog-backdrop phrase-word-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="dialog-card phrase-word-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <h2 id={titleId} lang="en">{word}</h2>
          <button type="button" className="icon-button" aria-label="关闭查词" onClick={onClose}><Icon name="close" size={20} /></button>
        </header>
        <div className="phrase-word-pronunciations" role="group" aria-label="单词发音">
          <button type="button" aria-label={`播放 ${word} 英式发音`} onClick={() => void speakWord(pronunciation, 'uk')}>
            <Icon name="volume" size={18} /><strong>UK</strong>{uk && <span>{printIpa(uk)}</span>}
          </button>
          <button type="button" aria-label={`播放 ${word} 美式发音`} onClick={() => void speakWord(pronunciation, 'us')}>
            <Icon name="volume" size={18} /><strong>US</strong>{us && <span>{printIpa(us)}</span>}
          </button>
        </div>
        {!uk && !us && bundled?.ipa && <p className="phrase-word-ipa">音标 {printIpa(bundled.ipa)}</p>}
        {glosses.length > 0
          ? <ul className="phrase-word-glosses">{glosses.map(gloss => <li key={gloss}>{gloss}</li>)}</ul>
          : <p className="phrase-word-glosses">本地词典暂未收录这个词的释义。</p>}
        {components.length > 0 && <ul className="phrase-word-components" aria-label="组成部分释义">{[...new Set(components)].map(gloss => <li key={gloss}>{gloss}</li>)}</ul>}
      </section>
    </div>,
    document.body,
  )
}
