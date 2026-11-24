import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import { useOutputScroll, type OutputScroll } from '../ui/hooks/use-output-scroll'
import { outputScrollCommand } from '../ui/shells-model'
import {
  drawerShellsOf,
  isDrawerShellRunning,
  shellFoldOf,
  shellOutputOf,
  type DrawerShell,
} from './drawer-shells'
import type { ShellRow } from '@dltech/atlas-plugin-shells/core'

export type ShellsDrawer = {
  open: boolean
  rows: readonly DrawerShell[]
  selected: DrawerShell | undefined
  output: string
  scroll: OutputScroll
  fold: { hidden: number; hiddenFailed: boolean }
  handleOpen: (shellId?: string) => void
  handleToggle: () => void
  handleDismiss: () => void
  handleKey: (key: KeyEvent) => void
}

type DrawerState = { index: number }

const openOn = (args: {
  rows: readonly DrawerShell[]
  shellId?: string | undefined
}): DrawerState => {
  const asked =
    args.shellId === undefined ? -1 : args.rows.findIndex((row) => row.shellId === args.shellId)
  if (asked >= 0) return { index: asked }

  const running = args.rows.findIndex(isDrawerShellRunning)
  return { index: Math.max(running, 0) }
}

const moved = (args: { state: DrawerState; count: number; delta: number }): DrawerState => {
  if (args.count <= 0) return { index: 0 }
  const next = args.state.index + Math.trunc(args.delta)
  return { index: Math.min(Math.max(next, 0), args.count - 1) }
}

export function useShellsDrawer(args: {
  rows: readonly ShellRow[]
  sessionId: string
  tails: Readonly<Record<string, { text: string }>>
  onKill: (shellId: string) => void
}): ShellsDrawer {
  const rows = useMemo(
    () => drawerShellsOf({ rows: args.rows, sessionId: args.sessionId }),
    [args.rows, args.sessionId],
  )
  const [state, setState] = useState<DrawerState | null>(null)

  const selected =
    state === null ? undefined : rows[Math.min(Math.max(state.index, 0), rows.length - 1)]
  const openId = selected?.shellId
  const scroll = useOutputScroll({ resetKey: openId })
  const output = openId === undefined ? '' : shellOutputOf({ tails: args.tails, shellId: openId })

  const handleOpen = useCallback((shellId?: string) => setState(openOn({ rows, shellId })), [rows])

  const handleDismiss = useCallback(() => setState(null), [])

  const handleToggle = useCallback(() => {
    if (state !== null) {
      setState(null)
      return
    }
    setState(openOn({ rows }))
  }, [rows, state])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (state === null) return

      if (key.name === 'escape' || key.name === 'q') {
        handleDismiss()
        return
      }

      const scrolling = outputScrollCommand(key)
      if (scrolling !== null) {
        scroll.handleCommand(scrolling)
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        setState(moved({ state, count: rows.length, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'k' || key.name === 'x') {
        const target = rows[state.index]
        if (target !== undefined) args.onKill(target.shellId)
      }
    },
    [args, handleDismiss, rows, scroll, state],
  )

  const fold = useMemo(() => shellFoldOf(rows), [rows])

  return useMemo(
    () => ({
      open: state !== null,
      rows,
      selected,
      output,
      scroll,
      fold,
      handleOpen,
      handleToggle,
      handleDismiss,
      handleKey,
    }),
    [
      fold,
      handleDismiss,
      handleKey,
      handleOpen,
      handleToggle,
      output,
      rows,
      scroll,
      selected,
      state,
    ],
  )
}
