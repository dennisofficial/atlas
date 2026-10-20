import type { KeyEvent, PasteEvent } from '@opentui/core'
import { usePaste } from '@opentui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isPrintable } from '../ui/keys/printable'
import { pastedText } from '../ui/pasted-text'
import {
  appended,
  createAnswer,
  editField,
  EProjectAnswer,
  EProjectField,
  EProjectPrompt,
  focusField,
  moveProjectRow,
  openProjectPrompt,
  pickAnswer,
  problemOf,
  switchField,
  withoutLast,
  type CreateState,
  type PickState,
  type ProjectAnswer,
  type ProjectPromptState,
  type ProjectRequest,
} from '../ui/project-prompt-model'

export type ProjectPromptControl = {
  state: ProjectPromptState | null
  ask: (request: ProjectRequest) => Promise<ProjectAnswer>
  isMounted: () => boolean
  handleKey: (key: KeyEvent) => void
  handlePickRow: (index: number) => void
  handleFocusField: (field: EProjectField) => void
  handleCancel: () => void
}

const CANCELLED: ProjectAnswer = { kind: EProjectAnswer.Cancelled }

/**
 * OpenTUI parses a whole input burst before React re-renders, so typed keys would all read one
 * rendered state; the ref is what the handlers read and write, React state only draws it.
 */
export function useProjectPrompt(): ProjectPromptControl {
  const held = useRef<ProjectPromptState | null>(null)
  const pending = useRef<((answer: ProjectAnswer) => void) | null>(null)
  const mounted = useRef(true)
  const [state, setState] = useState<ProjectPromptState | null>(null)

  const put = useCallback((next: ProjectPromptState | null) => {
    held.current = next
    setState(next)
  }, [])

  const settle = useCallback(
    (answer: ProjectAnswer) => {
      const resolve = pending.current
      pending.current = null
      put(null)
      resolve?.(answer)
    },
    [put],
  )

  const ask = useCallback(
    (request: ProjectRequest): Promise<ProjectAnswer> => {
      if (!mounted.current) return Promise.resolve(CANCELLED)
      settle(CANCELLED)
      return new Promise((resolve) => {
        pending.current = resolve
        put(openProjectPrompt(request))
      })
    },
    [put, settle],
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current?.(CANCELLED)
      pending.current = null
    }
  }, [])

  const isMounted = useCallback(() => mounted.current, [])

  const handleCancel = useCallback(() => settle(CANCELLED), [settle])

  const handlePickRow = useCallback(
    (index: number) => {
      const current = held.current
      if (current === null || current.mode !== EProjectPrompt.Pick) return
      const answer = pickAnswer({ state: current, index })
      if (answer !== null) settle(answer)
    },
    [settle],
  )

  const handleFocusField = useCallback(
    (field: EProjectField) => {
      const current = held.current
      if (current === null || current.mode !== EProjectPrompt.Create) return
      put(focusField({ state: current, field }))
    },
    [put],
  )

  const handlePickKey = useCallback(
    (key: KeyEvent, current: PickState) => {
      if (key.name === 'up' || key.name === 'down') {
        put(moveProjectRow({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return
      }
      if (key.name === 'return') handlePickRow(current.index)
    },
    [handlePickRow, put],
  )

  const handleCreateKey = useCallback(
    (key: KeyEvent, current: CreateState) => {
      if (key.name === 'tab') {
        put(switchField(current))
        return
      }
      if (key.name === 'return') {
        const problem = problemOf(current)
        if (problem !== null) put({ ...current, problem })
        else settle(createAnswer(current))
        return
      }
      if (key.name === 'backspace') {
        put(editField({ state: current, edit: withoutLast }))
        return
      }
      if (isPrintable(key)) put(editField({ state: current, edit: appended(key.sequence ?? '') }))
    },
    [put, settle],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      const current = held.current
      if (current === null) return
      if (key.name === 'escape') {
        handleCancel()
        return
      }
      if (current.mode === EProjectPrompt.Pick) handlePickKey(key, current)
      else handleCreateKey(key, current)
    },
    [handleCancel, handleCreateKey, handlePickKey],
  )

  usePaste(
    useCallback(
      (event: PasteEvent) => {
        const current = held.current
        if (current === null || current.mode !== EProjectPrompt.Create) return
        const pasted = pastedText(event)
        if (pasted.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        put(editField({ state: current, edit: appended(pasted) }))
      },
      [put],
    ),
  )

  return useMemo(
    () => ({ state, ask, isMounted, handleKey, handlePickRow, handleFocusField, handleCancel }),
    [ask, handleCancel, handleFocusField, handleKey, handlePickRow, isMounted, state],
  )
}
