import { useCallback, useRef, useState } from 'react'
import { createVoiceHistoryWriter, type VoiceHistoryMetadata } from './history'
import type { VoiceFeedback } from './feedback'

type Writer = ReturnType<typeof createVoiceHistoryWriter>
export function useVoiceHistory() {
  const writer = useRef<Writer | null>(null)
  const [status, setStatus] = useState('')
  const revision = useRef(0)
  const observe = useCallback((current: Writer, action: Promise<void>) => {
    const version = ++revision.current
    setStatus('正在保存练习记录…')
    void action.then(() => {
      if (writer.current === current && revision.current === version) setStatus('练习记录已保存到本机，可在「练习历史」回看。')
      return undefined
    }, () => {
      if (writer.current === current && revision.current === version) setStatus('练习记录保存失败，请检查浏览器存储空间后重试；离开前请先下载文字。')
    })
  }, [])
  const begin = useCallback((metadata: VoiceHistoryMetadata) => {
    writer.current = createVoiceHistoryWriter(metadata)
    setStatus('有对话内容后会自动保存到本机。')
  }, [])
  const save = useCallback((patch: Parameters<Writer['update']>[0]) => {
    const current = writer.current
    if (current) observe(current, current.update(patch))
  }, [observe])
  const corrections = useCallback((turnId: string, value: VoiceFeedback['corrections']) => {
    const current = writer.current
    if (current) observe(current, current.corrections(turnId, value))
  }, [observe])
  return { begin, save, corrections, status, retry: () => save({}) }
}
