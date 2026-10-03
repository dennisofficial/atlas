import type { ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  operatorInputReplySchema,
  type ChannelSignal,
  type OperatorInputRequest,
  type RemoteDeltaChannel,
  type RemoteTurnRunner,
} from '@dltech/atlas-harness'
import { decodePasteBytes, type KeyEvent, type PasteEvent, type TextareaRenderable } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { operatorEditorText, operatorTextAfterEdit, operatorTextWithPaste } from '../ui/operator-input-text'
import { chordMatches } from '../ui/keys'
import type { AtlasApp } from './compose'

export type OperatorInputReady = {
  kind: 'awaiting'
  request: OperatorInputRequest
  typed: string
  failure: string | null
}

export type OperatorInputState =
  | OperatorInputReady
  | { kind: 'delivering'; request: OperatorInputRequest; typed: string }

export type OperatorInputControl = {
  state: OperatorInputState | null
  editor: RefObject<TextareaRenderable | null>
  handleChange: () => void
  handlePaste: (event: PasteEvent) => void
  handleKey: (key: KeyEvent) => void
  handleSubmit: () => void
  handleOpenUrl: () => void
}

const remoteChannelOf = (channel: unknown): RemoteDeltaChannel | null => {
  if (typeof channel !== 'object' || channel === null) return null
  if (!('request' in channel)) return null
  return channel as RemoteDeltaChannel
}

export function useOperatorInput(args: {
  app: AtlasApp
  threadId: ThreadId
  cloudRunner: RemoteTurnRunner | null
  onInterrupt: () => void
}): OperatorInputControl {
  const { app, threadId, cloudRunner, onInterrupt } = args
  const [state, setState] = useState<OperatorInputState | null>(null)
  const current = useRef(state)
  const editor = useRef<TextareaRenderable | null>(null)
  const generation = useRef(0)
  const pasting = useRef(false)
  const sourceHistory = useRef(new Map<string, string>())

  const update = useCallback((next: OperatorInputState | null) => {
    if (next === null || next.request.requestId !== current.current?.request.requestId) sourceHistory.current.clear()
    if (next !== null) sourceHistory.current.set(operatorEditorText(next.typed), next.typed)
    current.current = next
    setState(next)
  }, [])

  useEffect(() => {
    generation.current++
    update(null)
    const unsubscribe = app.channel.subscribe({
      threadId,
      listener: (signal: ChannelSignal) => {
        if (signal.type !== 'operator-input') return
        const before = current.current
        if (signal.request !== null && before?.request.requestId === signal.request.requestId) {
          update({ ...before, request: signal.request })
          return
        }
        generation.current++
        update(signal.request === null
          ? null
          : { kind: 'awaiting', request: signal.request, typed: '', failure: null })
      },
    })
    return () => {
      generation.current++
      unsubscribe()
    }
  }, [app.channel, threadId, update])

  const submit = useCallback(
    async (ready: OperatorInputReady) => {
      const value = editor.current === null
        ? ready.typed
        : sourceHistory.current.get(editor.current.plainText) ?? operatorTextAfterEdit({ source: ready.typed, edited: editor.current.plainText })
      const attempt = ++generation.current
      update({ kind: 'delivering', request: ready.request, typed: value })
      const fail = (reason: string) => {
        if (attempt !== generation.current) return
        update({ kind: 'awaiting', request: ready.request, typed: value, failure: reason })
      }
      const undelivered = () => {
        if (attempt !== generation.current) return
        generation.current++
        update(null)
      }

      try {
        if (cloudRunner !== null) {
          const channel = remoteChannelOf(app.channel)
          if (channel === null) {
            fail('the channel to the sandbox is not open')
            return
          }
          const reply = operatorInputReplySchema.parse(
            await channel.request({
              op: EClientRequest.ProvideOperatorInput,
              params: { requestId: ready.request.requestId, value },
            }),
          )
          if (!reply.delivered) undelivered()
          return
        }

        const answered = await app.operatorInput.answer({
          requestId: ready.request.requestId,
          value,
        })
        if (!answered.ok) undelivered()
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
    },
    [app.channel, app.operatorInput, cloudRunner, update],
  )

  const handleChange = useCallback(() => {
    const before = current.current
    if (before?.kind !== 'awaiting' || editor.current === null || pasting.current) return
    const edited = editor.current.plainText
    const typed = sourceHistory.current.get(edited) ?? operatorTextAfterEdit({ source: before.typed, edited })
    update({ ...before, typed })
  }, [update])

  const handlePaste = useCallback((event: PasteEvent) => {
    const before = current.current
    const target = editor.current
    if (before?.kind !== 'awaiting' || target === null) return
    event.preventDefault()
    event.stopPropagation()
    const pasted = decodePasteBytes(event.bytes)
    const selection = target.getSelection()
    const start = target.editBuffer.getTextRange(0, selection === null ? target.cursorOffset : Math.min(selection.start, selection.end)).length
    const end = target.editBuffer.getTextRange(0, selection === null ? target.cursorOffset : Math.max(selection.start, selection.end)).length
    const source = operatorTextAfterEdit({ source: before.typed, edited: target.plainText })
    pasting.current = true
    try {
      target.insertText(pasted)
    } finally {
      pasting.current = false
    }
    update({ ...before, typed: operatorTextWithPaste({ source, start, end, pasted }) })
  }, [update])

  const handleSubmit = useCallback(() => {
    const ready = current.current
    if (ready?.kind !== 'awaiting') return
    void submit(ready)
  }, [submit])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (current.current === null || key.eventType === 'release') return
      if (key.name === 'escape') {
        key.preventDefault()
        onInterrupt()
        return
      }
      if (chordMatches({ chord: 'return', press: key })) {
        key.preventDefault()
        handleSubmit()
        return
      }
      if (current.current.kind === 'delivering') key.preventDefault()
    },
    [handleSubmit, onInterrupt],
  )

  const handleOpenUrl = useCallback(() => {
    const url = current.current?.request.url
    if (url !== undefined) app.openUrl(url)
  }, [app.openUrl])

  return useMemo(
    () => ({ state, editor, handleChange, handlePaste, handleKey, handleSubmit, handleOpenUrl }),
    [state, handleChange, handlePaste, handleKey, handleSubmit, handleOpenUrl],
  )
}
