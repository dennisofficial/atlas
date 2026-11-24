import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { FileContent } from '@dltech/atlas-protocol'

import type { ContextSectionProps } from '../ui/components/sidebar/context'
import {
  contextTreeRows,
  toggleContextClosed,
  type ContextTreeLevel,
  type ContextTreeLevels,
} from '../ui/context-tree-model'
import { EOutputScroll, outputScrollCommand } from '../ui/shells-model'
import type { SessionApi } from './session-api'

const NO_LEVELS: ContextTreeLevels = new Map()
const NO_CLOSED: ReadonlySet<string> = new Set()

const READ_DEBOUNCE_MS = 150

const LINES_PER_PRESS = 3

const PAN_COLUMNS = 8

export type ContextFilesApi = Pick<SessionApi, 'browseContext' | 'readContext'>

export type ContextViewerState = {
  path: string
  loading: boolean
  content: FileContent | null
}

export type ContextTreeControl = {
  section: Omit<ContextSectionProps, 'cells'>
  viewer: ContextViewerState | null
  handleDismiss: () => void
  handleKey: (key: KeyEvent) => void
  attachScroll: (box: ScrollBoxRenderable | null) => void
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const pathOf = (args: { directory: string; name: string }): string =>
  args.directory === '' ? args.name : `${args.directory}/${args.name}`

const entriesOf = (listing: readonly { name: string; isDirectory: boolean }[]) =>
  listing.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }))

const readLevels = async (args: {
  api: ContextFilesApi
  sessionId: string
  closed: ReadonlySet<string>
  previous: ContextTreeLevels
}): Promise<ContextTreeLevels> => {
  const levels = new Map<string, ContextTreeLevel>()
  const visit = async (directory: string): Promise<void> => {
    try {
      const reply = await args.api.browseContext({ sessionId: args.sessionId, directory })
      const entries = entriesOf(reply.entries)
      levels.set(directory, { entries, error: null })
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory)
          .map((entry) => pathOf({ directory, name: entry.name }))
          .filter((path) => !args.closed.has(path))
          .map((path) => visit(path)),
      )
    } catch (cause) {
      levels.set(directory, {
        entries: args.previous.get(directory)?.entries ?? [],
        error: messageOf(cause),
      })
    }
  }
  await visit('')
  return levels
}

const scrolled = (args: { box: ScrollBoxRenderable; key: KeyEvent }): boolean => {
  if (args.key.name === 'left' || args.key.name === 'right') {
    args.box.scrollBy({ x: args.key.name === 'left' ? -PAN_COLUMNS : PAN_COLUMNS, y: 0 })
    return true
  }
  const command =
    args.key.name === 'up' || args.key.name === 'down'
      ? {
          kind: EOutputScroll.Lines,
          amount: args.key.name === 'up' ? -LINES_PER_PRESS : LINES_PER_PRESS,
        }
      : outputScrollCommand(args.key)
  if (command === null) return false
  if (command.kind === EOutputScroll.ToEnd)
    args.box.scrollTo(Math.max(0, args.box.scrollHeight - args.box.viewport.height))
  else if (command.kind === EOutputScroll.ToStart) args.box.scrollTo(0)
  else if (command.kind === EOutputScroll.Pages) args.box.scrollBy(command.amount, 'viewport')
  else args.box.scrollBy(command.amount)
  return true
}

const sameLevels = (args: { left: ContextTreeLevels; right: ContextTreeLevels }): boolean => {
  if (args.left.size !== args.right.size) return false
  for (const [path, left] of args.left) {
    const right = args.right.get(path)
    if (right === undefined) return false
    if (left.error !== right.error || left.entries.length !== right.entries.length) return false
    const differs = left.entries.some((entry, index) => {
      const other = right.entries[index]
      return (
        other === undefined || entry.name !== other.name || entry.isDirectory !== other.isDirectory
      )
    })
    if (differs) return false
  }
  return true
}

export function useContextTree(args: {
  api: ContextFilesApi
  sessionId: string
  head: number
}): ContextTreeControl {
  const [closed, setClosed] = useState<ReadonlySet<string>>(NO_CLOSED)
  const [levels, setLevels] = useState<ContextTreeLevels>(NO_LEVELS)
  const [opened, setOpened] = useState<string | null>(null)
  const [read, setRead] = useState<{ path: string; file: FileContent } | null>(null)
  const [revision, setRevision] = useState(0)
  const scroller = useRef<ScrollBoxRenderable | null>(null)
  const levelsHeld = useRef<ContextTreeLevels>(NO_LEVELS)
  levelsHeld.current = levels

  const handleDismiss = useCallback(() => {
    setOpened(null)
    setRead(null)
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      void readLevels({
        api: args.api,
        sessionId: args.sessionId,
        closed,
        previous: levelsHeld.current,
      }).then((next) => {
        if (!live) return
        setLevels((current) => (sameLevels({ left: current, right: next }) ? current : next))
      })
    }, READ_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [args.api, args.sessionId, args.head, closed, revision])

  useEffect(() => {
    if (opened === null) return
    let live = true
    void args.api
      .readContext({ sessionId: args.sessionId, path: opened })
      .catch((cause: unknown): { file: FileContent } => ({
        file: { type: 'refused', path: opened, reason: messageOf(cause) },
      }))
      .then((reply) => {
        if (live) setRead({ path: opened, file: reply.file })
      })
    return () => {
      live = false
    }
  }, [args.api, args.sessionId, opened, revision])

  const rows = useMemo(() => contextTreeRows({ levels, closed }), [levels, closed])

  const handleActivate = useCallback(
    (path: string) => {
      const row = rows.find((entry) => entry.path === path)
      if (row === undefined) return
      if (row.isDirectory) {
        setClosed((current) => toggleContextClosed({ closed: current, path }))
        return
      }
      if (path === opened) {
        handleDismiss()
        return
      }
      setOpened(path)
    },
    [rows, opened, handleDismiss],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (key.name === 'escape') {
        handleDismiss()
        return
      }
      const box = scroller.current
      if (box !== null) scrolled({ box, key })
    },
    [handleDismiss],
  )

  const attachScroll = useCallback((box: ScrollBoxRenderable | null) => {
    scroller.current = box
  }, [])

  const section = useMemo<Omit<ContextSectionProps, 'cells'>>(
    () => ({
      rows,
      levels,
      opened,
      loading: levels.get('') === undefined,
      onActivate: handleActivate,
    }),
    [handleActivate, levels, opened, rows],
  )

  const viewer = useMemo<ContextViewerState | null>(
    () =>
      opened === null
        ? null
        : {
            path: opened,
            loading: read?.path !== opened,
            content: read?.path === opened ? read.file : null,
          },
    [opened, read],
  )

  return useMemo(
    () => ({ section, viewer, handleDismiss, handleKey, attachScroll }),
    [attachScroll, handleDismiss, handleKey, section, viewer],
  )
}
