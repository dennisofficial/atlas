import type { KeyEvent } from '@opentui/core'

import {
  backspace,
  moveSelection,
  selectedThread,
  typeInto,
  type ThreadRow,
  type ThreadsState,
} from '../ui/threads-model'
import { isPrintable } from '../ui/keys/printable'

export function routeThreadKey(args: {
  key: KeyEvent
  current: ThreadsState | null
  put: (next: ThreadsState | null) => void
  handleDismiss: () => void
  handlePick: (row: ThreadRow) => void
}): void {
  const { key, current, put, handleDismiss, handlePick } = args
  if (current === null) return

  if (key.name === 'escape') {
    handleDismiss()
    return
  }

  if (key.name === 'up' || key.name === 'down') {
    put(moveSelection({ state: current, delta: key.name === 'up' ? -1 : 1 }))
    return
  }

  if (key.name === 'return') {
    const row = selectedThread(current)
    if (row !== undefined) handlePick(row)
    return
  }

  if (key.name === 'backspace') {
    put(backspace(current))
    return
  }

  if (isPrintable(key)) put(typeInto({ state: current, text: key.sequence ?? '' }))
}
