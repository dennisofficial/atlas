import {
  decodePasteBytes,
  type KeyEvent,
  type PasteEvent,
  type TextareaRenderable,
} from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { chordMatches } from '../ui/keys'
import {
  operatorEditorText,
  operatorTextAfterEdit,
  operatorTextWithPaste,
} from '../ui/operator-input-text'
import type { OperatorInputReady, OperatorInputState } from '../ui/operator-input-state'
import { awaitingStateOf, deliveringStateOf, failedStateOf } from './operator-input-model'
import type { PendingOperatorRequest } from './operator-request'
import type { SessionApi } from './session-api'

export type OperatorInputControl = {
  state: OperatorInputState | null
  editor: RefObject<TextareaRenderable | null>
  handleChange: () => void
  handlePaste: (event: PasteEvent) => void
  handleKey: (key: KeyEvent) => boolean
  handleSubmit: () => void
  handleCancel: () => void
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useOperatorInput(args: {
  api: SessionApi
  sessionId: string
  request: PendingOperatorRequest | null
  onProblem: (reason: string) => void
}): OperatorInputControl {
  const { api, sessionId, request } = args
  const [state, setState] = useState<OperatorInputState | null>(null)
  const current = useRef(state)
  const editor = useRef<TextareaRenderable | null>(null)
  const generation = useRef(0)
  const pasting = useRef(false)
  const sourceHistory = useRef(new Map<string, string>())
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem

  const update = useCallback((next: OperatorInputState | null) => {
    if (next === null || next.request.requestId !== current.current?.request.requestId)
      sourceHistory.current.clear()
    if (next !== null) sourceHistory.current.set(operatorEditorText(next.typed), next.typed)
    current.current = next
    setState(next)
  }, [])

  const callId = request?.callId ?? null

  useEffect(() => {
    generation.current++
    if (request === null) {
      update(null)
      return
    }
    if (current.current?.request.requestId === request.callId) return
    update(awaitingStateOf({ request }))
  }, [callId, update])

  const submit = useCallback(
    async (ready: OperatorInputReady) => {
      const value =
        editor.current === null
          ? ready.typed
          : (sourceHistory.current.get(editor.current.plainText) ??
            operatorTextAfterEdit({ source: ready.typed, edited: editor.current.plainText }))
      const attempt = ++generation.current
      update(deliveringStateOf({ request: ready.request, typed: value }))

      try {
        await api.answerOperator({ sessionId, callId: ready.request.requestId, value })
      } catch (failure) {
        if (attempt !== generation.current) return
        update(failedStateOf({ request: ready.request, typed: value, reason: messageOf(failure) }))
      }
    },
    [api, sessionId, update],
  )

  const handleChange = useCallback(() => {
    const before = current.current
    if (before?.kind !== 'awaiting' || editor.current === null || pasting.current) return
    const edited = editor.current.plainText
    const typed =
      sourceHistory.current.get(edited) ?? operatorTextAfterEdit({ source: before.typed, edited })
    update({ ...before, typed })
  }, [update])

  const handlePaste = useCallback(
    (event: PasteEvent) => {
      const before = current.current
      const target = editor.current
      if (before?.kind !== 'awaiting' || target === null) return
      event.preventDefault()
      event.stopPropagation()
      const pasted = decodePasteBytes(event.bytes)
      const selection = target.getSelection()
      const start = target.editBuffer.getTextRange(
        0,
        selection === null ? target.cursorOffset : Math.min(selection.start, selection.end),
      ).length
      const end = target.editBuffer.getTextRange(
        0,
        selection === null ? target.cursorOffset : Math.max(selection.start, selection.end),
      ).length
      const source = operatorTextAfterEdit({ source: before.typed, edited: target.plainText })
      pasting.current = true
      try {
        target.insertText(pasted)
      } finally {
        pasting.current = false
      }
      update({ ...before, typed: operatorTextWithPaste({ source, start, end, pasted }) })
    },
    [update],
  )

  const handleSubmit = useCallback(() => {
    const ready = current.current
    if (ready?.kind !== 'awaiting') return
    void submit(ready)
  }, [submit])

  const handleCancel = useCallback(() => {
    const ready = current.current
    if (ready?.kind !== 'awaiting') return
    const attempt = ++generation.current
    void api
      .answerOperator({ sessionId, callId: ready.request.requestId, cancel: true })
      .catch((failure: unknown) => {
        if (attempt !== generation.current) return
        update(
          failedStateOf({ request: ready.request, typed: ready.typed, reason: messageOf(failure) }),
        )
      })
  }, [api, sessionId, update])

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (current.current === null) return false
      if (key.eventType === 'release') return false
      if (key.name === 'escape') {
        key.preventDefault()
        handleCancel()
        return true
      }
      if (chordMatches({ chord: 'return', press: key })) {
        key.preventDefault()
        handleSubmit()
        return true
      }
      if (current.current.kind === 'delivering') key.preventDefault()
      return true
    },
    [handleCancel, handleSubmit],
  )

  return useMemo(
    () => ({
      state,
      editor,
      handleChange,
      handlePaste,
      handleKey,
      handleSubmit,
      handleCancel,
    }),
    [state, handleChange, handlePaste, handleKey, handleSubmit, handleCancel],
  )
}
