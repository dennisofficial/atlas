import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ThreadId } from '@dltech/atlas-core'
import { EKilledBy, type ShellSnapshot } from '@dltech/atlas-harness'

import { useTickingNow } from './use-ticking-now'
import type { SidebarCrewFold } from '../store/subagent-row'
import { useOutputScroll, type OutputScroll } from '../ui/hooks/use-output-scroll'
import {
  isShellRunning,
  moveShellSelection,
  openShells,
  outputScrollCommand,
  runningCount,
  selectShell,
  selectedShell,
  type ShellsState,
} from '../ui/shells-model'
import type { AtlasApp } from './compose'

/**
 * The scrollback a reader can walk back through, well short of the 400k the registry retains: every
 * poll that finds new output re-wraps this whole tail.
 */
const PEEKED_CHARACTERS = 64_000

const KILL_KEYS = new Set(['k', 'x'])

export type ShellsControl = {
  shells: readonly ShellSnapshot[]
  folded: readonly ShellSnapshot[]
  fold: SidebarCrewFold
  everywhere: readonly ShellSnapshot[]
  running: number
  now: number
  state: ShellsState | null
  selected: ShellSnapshot | undefined
  output: string
  scroll: OutputScroll
  handleOpen: (shellId?: string) => void
  handleDismiss: () => void
  handleSelect: (shellId: string) => void
  handleKill: (shellId: string) => void
  handleKey: (key: KeyEvent) => void
}

const sameShells = (left: readonly ShellSnapshot[], right: readonly ShellSnapshot[]): boolean => {
  if (left.length !== right.length) return false

  return left.every((shell, index) => {
    const other = right[index]
    if (other === undefined) return false
    return (
      shell.shellId === other.shellId &&
      shell.status === other.status &&
      shell.exitCode === other.exitCode &&
      shell.awaitingInput === other.awaitingInput &&
      shell.totalCharacters === other.totalCharacters
    )
  })
}

type ShellLists = { own: readonly ShellSnapshot[]; everywhere: readonly ShellSnapshot[] }

const keptIfSame = (
  current: readonly ShellSnapshot[],
  latest: readonly ShellSnapshot[],
): readonly ShellSnapshot[] => (sameShells(current, latest) ? current : latest)

/**
 * The registry publishes every change — structurally on start and exit, throttled for output — so
 * the lists re-read when there is something to show and never on a timer. `read` still re-runs on
 * its own change: switching conversations re-scopes the list at once rather than after the next
 * activity. The snapshot comparison keeps the tree still when an event changed nothing visible.
 */
function useShellSnapshots(args: {
  shells: AtlasApp['shells']
  read: () => ShellLists
}): ShellLists {
  const [lists, setLists] = useState<ShellLists>(args.read)

  useEffect(() => {
    const update = (): void =>
      setLists((current) => {
        const latest = args.read()
        const own = keptIfSame(current.own, latest.own)
        const everywhere = keptIfSame(current.everywhere, latest.everywhere)

        return own === current.own && everywhere === current.everywhere
          ? current
          : { own, everywhere }
      })

    update()
    return args.shells.subscribe(update)
  }, [args.shells, args.read])

  return lists
}

/**
 * The sidebar lists only what is still running; a finished shell leaves the panel at once and
 * stays reachable through /shells. The tick exists for the live readouts alone, so it runs while
 * a shell is running and stops with the last of them.
 */
/**
 * The scoped list is what a conversation may see and act on; the unscoped one exists for the exit
 * guard alone, because quitting kills every shell in the process whoever started it.
 */
export function useShells({ app, threadId }: { app: AtlasApp; threadId: ThreadId }): ShellsControl {
  const read = useCallback(
    (): ShellLists => ({
      own: app.shells.list({ threadId }),
      everywhere: app.shells.listEverywhere(),
    }),
    [app, threadId],
  )
  const { own: shells, everywhere } = useShellSnapshots({ shells: app.shells, read })
  const [state, setState] = useState<ShellsState | null>(null)

  const selected = state === null ? undefined : selectedShell({ state, shells })

  const now = useTickingNow(shells.some(isShellRunning))

  const folded = useMemo(() => shells.filter(isShellRunning), [shells])

  const [output, setOutput] = useState('')
  const openId = selected?.shellId
  const printed = selected?.totalCharacters
  const scroll = useOutputScroll({ resetKey: openId })

  useEffect(() => {
    if (openId === undefined) {
      setOutput('')
      return
    }
    setOutput(app.shells.peek({ shellId: openId, characters: PEEKED_CHARACTERS, threadId }) ?? '')
  }, [app, openId, printed, threadId])

  const handleOpen = useCallback(
    (shellId?: string) =>
      setState(openShells({ shells, ...(shellId === undefined ? {} : { shellId }) })),
    [shells],
  )

  const handleDismiss = useCallback(() => setState(null), [])

  const handleSelect = useCallback(
    (shellId: string) => setState(selectShell({ shells, shellId })),
    [shells],
  )

  const handleKill = useCallback(
    (shellId: string) => {
      app.shells.kill({ shellId, by: EKilledBy.User, threadId })
      setState((current) => (current === null ? null : { ...current }))
    },
    [app, threadId],
  )

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
        setState(
          moveShellSelection({ state, count: shells.length, delta: key.name === 'up' ? -1 : 1 }),
        )
        return
      }

      const pressed = key.sequence?.toLowerCase() ?? ''
      if (KILL_KEYS.has(pressed) && selected !== undefined) handleKill(selected.shellId)
    },
    [handleDismiss, handleKill, scroll, selected, shells.length, state],
  )

  return useMemo(
    () => ({
      shells,
      folded,
      fold: { hidden: shells.length - folded.length, hiddenFailed: false },
      everywhere,
      running: runningCount(everywhere),
      now,
      state,
      selected,
      output,
      scroll,
      handleOpen,
      handleDismiss,
      handleSelect,
      handleKill,
      handleKey,
    }),
    [
      handleDismiss,
      handleKey,
      handleKill,
      handleOpen,
      handleSelect,
      everywhere,
      folded,
      now,
      output,
      scroll,
      selected,
      shells,
      state,
    ],
  )
}
