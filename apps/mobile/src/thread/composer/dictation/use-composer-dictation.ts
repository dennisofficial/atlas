import { useCallback, useEffect, useRef, useState } from 'react'

import type { SharedValue } from 'react-native-reanimated'

import { type ITranscript, transcriptTextOf } from './transcript-model'
import { useDictation } from './use-dictation'
import { useGatewayDictationEngine } from './use-gateway-dictation-engine'

export interface IComposerDictationState {
  active: boolean
  error: string | null
  transcript: ITranscript
  history: SharedValue<readonly number[]>
  before: string
  after: string
  displayText: string
  start: () => void
  stop: () => void
  finish: () => Promise<string>
  handleSelection: (selection: { start: number; end: number }) => void
}

const SETTLE_TIMEOUT_MS = 4000

const joinInto = ({ before, spoken, after }: { before: string; spoken: string; after: string }) => {
  if (spoken === '') return `${before}${after}`
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const trail = after === '' || /^[\s.,!?;:)\]}']/.test(after) ? '' : ' '
  return `${before}${lead}${spoken}${trail}${after}`
}

export const useComposerDictation = ({
  text,
  onChangeText,
}: {
  text: string
  onChangeText: (next: string) => void
}): IComposerDictationState => {
  const engine = useGatewayDictationEngine()
  const dictation = useDictation({ engine })
  const [split, setSplit] = useState({ before: '', after: '' })
  const cursorRef = useRef<number | null>(null)
  const settlingRef = useRef(false)
  const resolveSettledRef = useRef<((next: string) => void) | null>(null)
  const spoken = transcriptTextOf(dictation.transcript)
  const displayRef = useRef(text)
  displayRef.current = joinInto({ before: split.before, spoken, after: split.after })

  const handleSelection = useCallback(({ start }: { start: number; end: number }) => {
    cursorRef.current = start
  }, [])

  const start = useCallback(() => {
    const cursor = cursorRef.current === null ? text.length : cursorRef.current
    const at = Math.min(Math.max(cursor, 0), text.length)
    settlingRef.current = true
    setSplit({ before: text.slice(0, at), after: text.slice(at) })
    dictation.start()
  }, [dictation, text])

  const stop = useCallback(() => {
    dictation.stop()
  }, [dictation])

  const finish = useCallback(async (): Promise<string> => {
    if (!dictation.active) return text
    const settled = new Promise<string>((resolve) => {
      resolveSettledRef.current = resolve
    })
    const expired = new Promise<string>((resolve) => {
      setTimeout(() => resolve(displayRef.current), SETTLE_TIMEOUT_MS)
    })
    dictation.stop()
    return Promise.race([settled, expired])
  }, [dictation, text])

  useEffect(() => {
    if (dictation.active || !settlingRef.current) return
    settlingRef.current = false
    const next = joinInto({ before: split.before, spoken, after: split.after })
    if (next !== text) onChangeText(next)
    resolveSettledRef.current?.(next)
    resolveSettledRef.current = null
  }, [dictation.active, onChangeText, split, spoken, text])

  return {
    active: dictation.active,
    error: dictation.error,
    transcript: dictation.transcript,
    history: dictation.history,
    before: split.before,
    after: split.after,
    displayText: dictation.active
      ? joinInto({ before: split.before, spoken, after: split.after })
      : text,
    start,
    stop,
    finish,
    handleSelection,
  }
}
