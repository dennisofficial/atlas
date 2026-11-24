import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo } from 'react'

import { chordMatches, EKeyGroup, EKeyLayer, type KeyBinding } from '../ui/keys'
import { chatBindings, chatPressHandled } from './chat-bindings'
import type { ConnectionView } from './connection-view'
import { dispatchPaneKey } from './pane-keys'
import type { CommandMenu } from './use-command-menu'
import type { OperatorInputControl } from './use-operator-input'
import type { RewindControl } from './use-rewind'
import type { RunAttentionControl } from './use-run-attention'
import type { SessionComposer } from './use-session-composer'
import type { SessionPanesControl } from './use-session-panes'
import { EPodWake, type PodWake } from './use-session-wake'
import type { FooterStripControl } from './use-footer-strip'

const global = (binding: Omit<KeyBinding, 'layer'>): KeyBinding => ({
  ...binding,
  layer: EKeyLayer.Global,
})

export function useChatKeys(args: {
  composer: SessionComposer
  handleTakeBack: () => boolean
  attention: RunAttentionControl
  wake: PodWake
  connection: ConnectionView
  operator: OperatorInputControl
  menu: CommandMenu
  rewind: RewindControl
  panes: SessionPanesControl
  footerStrip: FooterStripControl
  working: boolean
  onToggleSidebar: () => void
  onBack: () => void
  onStop: () => void
}): (key: KeyEvent) => boolean {
  const { composer, operator, menu, rewind, panes, wake, attention, connection } = args

  const handleEscape = useCallback(() => {
    if (args.working) {
      args.onStop()
      return
    }
    args.onBack()
  }, [args])

  const extra = useMemo<readonly KeyBinding[]>(() => {
    const list: KeyBinding[] = []
    if (!connection.cloudConnected) {
      list.push(
        global({
          chord: 'ctrl+r',
          hint: 'reconnect',
          describe: 'wake the sandbox and follow it again',
          group: EKeyGroup.Turn,
          run: wake.handleWake,
        }),
      )
    } else if (attention.handleRetry !== null) {
      list.push(
        global({
          chord: 'ctrl+r',
          hint: 'retry',
          describe: 'run the failed turn again',
          group: EKeyGroup.Turn,
          run: attention.handleRetry,
        }),
      )
    } else if (attention.handleResume !== null) {
      list.push(
        global({
          chord: 'ctrl+r',
          hint: 'resume',
          describe: 'pick the stopped turn up where it left off',
          group: EKeyGroup.Turn,
          run: attention.handleResume,
        }),
      )
    }
    if (wake.state !== EPodWake.Asleep) {
      list.push(
        global({
          chord: 'r',
          hint: 'wake',
          describe: 'wake the sandbox',
          group: EKeyGroup.Turn,
          run: () => {
            if (!composer.draftIsEmpty()) return false
            wake.handleWake()
            return true
          },
        }),
      )
    }
    return list
  }, [attention.handleResume, attention.handleRetry, composer, connection.cloudConnected, wake])

  const bindings = useMemo(
    () => [
      ...chatBindings({
        draftIsEmpty: composer.draftIsEmpty,
        onSubmit: composer.handleSubmit,
        onTakeBackPending: args.handleTakeBack,
        onAttachImage: composer.handleAttachImage,
        onEscape: handleEscape,
      }),
      ...extra,
    ],
    [args.handleTakeBack, composer, extra, handleEscape],
  )

  return useCallback(
    (key: KeyEvent): boolean => {
      if (dispatchPaneKey({ key, owners: panes.owners })) return true

      if (key.ctrl === true && key.name === 'b') {
        args.onToggleSidebar()
        return true
      }

      if (key.ctrl === true && key.name === 't') {
        panes.shells.handleToggle()
        return true
      }

      if (key.ctrl === true && key.name === 'g') return panes.crew.handleCycle()

      if (panes.crew.viewing !== null) {
        if (key.name === 'escape') panes.crew.handleEscape()
        return true
      }

      if (args.footerStrip.isOpen()) {
        args.footerStrip.handleKey(key)
        return true
      }

      if (operator.state !== null) return operator.handleKey(key)
      if (menu.handleKey(key)) return true
      if (args.footerStrip.handleEnter()) return true
      if (composer.handleKey(key)) return true
      if (rewind.handleKey(key)) return true
      return chatPressHandled({ press: key, bindings, match: chordMatches })
    },
    [args, bindings, composer, menu, operator, panes, rewind],
  )
}
