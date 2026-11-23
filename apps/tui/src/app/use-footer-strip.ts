import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { caretOnLastRow } from '../ui/composer-caret'
import type { FooterItem } from '../ui/footer-item'
import {
  enterStrip,
  EStripCommand,
  moveStripSelection,
  reconcileStrip,
  selectedStripItem,
  stripCommand,
  type FooterStripState,
} from '../ui/footer-strip'
import type { DraftControls } from '../ui/hooks/use-draft'

export type FooterStripControl = {
  items: readonly FooterItem[]
  state: FooterStripState | null
  isOpen: () => boolean
  handleEnter: () => boolean
  handleLeave: () => void
  handleActivate: (item: FooterItem) => void
  handleKey: (key: KeyEvent) => void
}

export function useFooterStrip(args: {
  items: readonly FooterItem[]
  draft: DraftControls
}): FooterStripControl {
  const { items, draft } = args
  const held = useRef<FooterStripState | null>(null)
  const [state, setState] = useState<FooterStripState | null>(null)

  const put = useCallback((next: FooterStripState | null) => {
    held.current = next
    setState(next)
  }, [])

  const handleLeave = useCallback(() => {
    put(null)
    draft.editor.current?.focus()
  }, [draft, put])

  const handleEnter = useCallback((): boolean => {
    const editor = draft.editor.current
    if (editor === null || !editor.focused) return false

    const onLastRow = caretOnLastRow({
      text: editor.plainText,
      offset: editor.cursorOffset,
      rowEndOffset: editor.editorView.getVisualEOL().offset,
    })
    if (!onLastRow) return false

    const entered = enterStrip(items)
    if (entered === null) return false

    put(entered)
    return true
  }, [draft, items, put])

  const handleActivate = useCallback((item: FooterItem) => item.onActivate?.(), [])

  const isOpen = useCallback((): boolean => held.current !== null, [])

  const handleTypeThrough = useCallback(
    (text: string) => {
      handleLeave()

      const editor = draft.editor.current
      if (editor === null) return

      editor.insertText(text)
      draft.sync(editor.plainText)
    },
    [draft, handleLeave],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      const command = stripCommand(key)
      if (command === null) return

      const current = held.current
      if (current === null) {
        if (command.kind === EStripCommand.TypeThrough) handleTypeThrough(command.text)
        return
      }

      if (command.kind === EStripCommand.Move) {
        put(moveStripSelection({ state: current, items, delta: command.delta }))
        return
      }

      if (command.kind === EStripCommand.Activate) {
        const item = selectedStripItem({ state: current, items })
        if (item !== undefined) handleActivate(item)
        return
      }

      if (command.kind === EStripCommand.Leave) {
        handleLeave()
        return
      }

      handleTypeThrough(command.text)
    },
    [handleActivate, handleLeave, handleTypeThrough, items, put],
  )

  useEffect(() => {
    const reconciled = reconcileStrip({ state: held.current, items })
    if (reconciled === held.current) return

    put(reconciled)
    if (reconciled === null) draft.editor.current?.focus()
  }, [draft, items, put])

  return useMemo(
    () => ({ items, state, isOpen, handleEnter, handleLeave, handleActivate, handleKey }),
    [handleActivate, handleEnter, handleKey, handleLeave, isOpen, items, state],
  )
}
