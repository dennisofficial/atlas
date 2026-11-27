import { useCallback, useEffect, useRef, useState } from 'react'

import type { SharedValue } from 'react-native-reanimated'

import { createDictationCursor } from './dictation-cursor'
import { insertionOf } from './dictation-insertion'
import { createFinishRequest, type IFinishRequest } from './finish-request'
import { type ITranscript, transcriptTextOf } from './transcript-model'
import { useDictation } from './use-dictation'
import { useGatewayDictationEngine } from './use-gateway-dictation-engine'

export interface IComposerSelection {
  start: number
  end: number
}

export interface IComposerDictationState {
  active: boolean
  error: string | null
  transcript: ITranscript
  history: SharedValue<readonly number[]>
  before: string
  after: string
  displayText: string
  selection: IComposerSelection | null
  start: () => void
  stop: () => void
  finish: () => Promise<string>
  handleSelection: (selection: IComposerSelection) => void
  handleFocus: () => void
  handleBlur: () => void
}

const SETTLE_TIMEOUT_MS = 4000

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
  const [selection, setSelection] = useState<IComposerSelection | null>(null)
  const cursorRef = useRef(createDictationCursor())
  const settlingRef = useRef(false)
  const resolveSettledRef = useRef<((next: string) => void) | null>(null)
  const finishingRef = useRef<IFinishRequest>(createFinishRequest())
  const spoken = transcriptTextOf(dictation.transcript)
  const displayRef = useRef(text)
  displayRef.current = insertionOf({ before: split.before, spoken, after: split.after }).text

  const handleSelection = useCallback(({ start }: IComposerSelection) => {
    cursorRef.current.select({ start })
  }, [])

  const handleFocus = useCallback(() => cursorRef.current.focus(), [])

  const handleBlur = useCallback(() => cursorRef.current.blur(), [])

  const start = useCallback(() => {
    const at = cursorRef.current.insertAt({ textLength: text.length })
    cursorRef.current.suspend()
    settlingRef.current = true
    setSelection(null)
    setSplit({ before: text.slice(0, at), after: text.slice(at) })
    dictation.start()
  }, [dictation, text])

  const stop = useCallback(() => {
    dictation.stop()
  }, [dictation])

  const finish = useCallback(async (): Promise<string> => {
    if (!dictation.active) return text
    return finishingRef.current.request(async () => {
      const settled = new Promise<string>((resolve) => {
        resolveSettledRef.current = resolve
      })
      const expired = new Promise<string>((resolve) => {
        setTimeout(() => resolve(displayRef.current), SETTLE_TIMEOUT_MS)
      })
      dictation.stop()
      return Promise.race([settled, expired])
    })
  }, [dictation, text])

  useEffect(() => {
    if (dictation.active || !settlingRef.current) return
    settlingRef.current = false
    const inserted = insertionOf({ before: split.before, spoken, after: split.after })
    if (inserted.text !== text) onChangeText(inserted.text)
    cursorRef.current.settle({ at: inserted.cursor })
    setSelection({ start: inserted.cursor, end: inserted.cursor })
    resolveSettledRef.current?.(inserted.text)
    resolveSettledRef.current = null
  }, [dictation.active, onChangeText, split, spoken, text])

  useEffect(() => {
    if (selection === null) return
    const timer = setTimeout(() => setSelection(null), 0)
    return () => clearTimeout(timer)
  }, [selection])

  return {
    active: dictation.active,
    error: dictation.error,
    transcript: dictation.transcript,
    history: dictation.history,
    before: split.before,
    after: split.after,
    displayText: dictation.active
      ? insertionOf({ before: split.before, spoken, after: split.after }).text
      : text,
    selection,
    start,
    stop,
    finish,
    handleSelection,
    handleFocus,
    handleBlur,
  }
}
