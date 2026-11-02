import type { KeyEvent, PasteEvent } from '@opentui/core'
import { usePaste } from '@opentui/react'
import { useCallback, type RefObject } from 'react'

import {
  backspace,
  backToActions,
  backToList,
  EAccountsView,
  isPrompting,
  moveAction,
  movePick,
  moveSelection,
  openActions,
  selectedAction,
  typeInto,
  type AccountsState,
  type EProviderAction,
} from '../ui/accounts-model'
import { pastedText } from '../ui/pasted-text'

const isPrintable = (key: KeyEvent): boolean => {
  const sequence = key.sequence ?? ''
  return sequence.length > 0 && !key.ctrl && !key.meta && !/[\u0000-\u001f]/.test(sequence)
}

export function useAccountsKeys(args: {
  held: RefObject<AccountsState | null>
  put: (next: AccountsState | null) => void
  onDismiss: () => void
  onCancelPrompt: () => void
  onRunAction: (current: AccountsState, action: EProviderAction | undefined) => void
  onConfirmPick: (current: AccountsState) => void
  onConfirmPause: (current: AccountsState) => void
  onSubmit: (current: AccountsState) => void
}): (key: KeyEvent) => void {
  const {
    held,
    put,
    onDismiss,
    onCancelPrompt,
    onRunAction,
    onConfirmPick,
    onConfirmPause,
    onSubmit,
  } = args

  const handleListKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        onDismiss()
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        put(moveSelection({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'return') put(openActions(current))
    },
    [onDismiss, put],
  )

  const handleActionsKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        put(backToList(current))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        put(moveAction({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'return') onRunAction(current, selectedAction(current))
    },
    [put, onRunAction],
  )

  const handlePickerKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        put(backToActions(current))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        put(movePick({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'return') onConfirmPick(current)
    },
    [onConfirmPick, put],
  )

  const handleConfirmKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        put(backToActions(current))
        return
      }

      if (key.name === 'return') onConfirmPause(current)
    },
    [onConfirmPause, put],
  )

  const handlePromptKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        onCancelPrompt()
        put(backToList(current))
        return
      }

      if (current.view === EAccountsView.DeviceCode || current.view === EAccountsView.BrowserCode) {
        return
      }

      if (key.name === 'return') {
        onSubmit(current)
        return
      }

      if (key.name === 'backspace') {
        put(backspace(current))
        return
      }

      if (isPrintable(key)) put(typeInto({ state: current, text: key.sequence ?? '' }))
    },
    [onCancelPrompt, onSubmit, put],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      const current = held.current
      if (current === null) return

      if (current.view === EAccountsView.List) {
        handleListKey(key, current)
        return
      }

      if (current.view === EAccountsView.Actions) {
        handleActionsKey(key, current)
        return
      }

      if (current.view === EAccountsView.SwitchLogin) {
        handlePickerKey(key, current)
        return
      }

      if (current.view === EAccountsView.ConfirmPause) {
        handleConfirmKey(key, current)
        return
      }

      handlePromptKey(key, current)
    },
    [handleActionsKey, handleConfirmKey, handleListKey, handlePickerKey, handlePromptKey, held],
  )

  usePaste(
    useCallback(
      (event: PasteEvent) => {
        const current = held.current
        if (current === null || !isPrompting(current)) return

        const pasted = pastedText(event)
        if (pasted.length === 0) return

        event.preventDefault()
        event.stopPropagation()
        put(typeInto({ state: current, text: pasted }))
      },
      [held, put],
    ),
  )

  return handleKey
}
