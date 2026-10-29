'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { watchContextFiles, type ContextLevel } from './context-files-source'
import {
  contextRowsOf,
  contextStatusOf,
  type ContextLevels,
  type ContextRow,
  type EContextStatus,
} from './context-tree-model'
import type { ServeChannel } from './live-thread-view'

export type ContextFiles = {
  rows: readonly ContextRow[]
  status: EContextStatus
  toggle: (row: ContextRow) => void
}

const NO_LEVELS: ContextLevels = new Map()
const NONE: ReadonlySet<string> = new Set()

export function useContextFiles(channel: ServeChannel | null): ContextFiles {
  const [held, setHeld] = useState<{
    channel: ServeChannel
    levels: ContextLevels
  } | null>(null)
  const levels = held !== null && held.channel === channel ? held.levels : NO_LEVELS
  const [openedState, setOpened] = useState<{
    channel: ServeChannel | null
    paths: ReadonlySet<string>
  }>({ channel, paths: NONE })
  const opened = openedState.channel === channel ? openedState.paths : NONE
  const loadRef = useRef<(directory: string) => void>(() => undefined)

  useEffect(() => {
    if (channel === null) {
      loadRef.current = () => undefined
      return
    }
    const watch = watchContextFiles({
      channel,
      onLevel: ({ directory, level }) =>
        setHeld((current) => {
          const base = current !== null && current.channel === channel ? current.levels : NO_LEVELS
          return {
            channel,
            levels: new Map<string, ContextLevel>(base).set(directory, level),
          }
        }),
    })
    loadRef.current = watch.load
    return watch.stop
  }, [channel])

  const rows = useMemo(() => contextRowsOf({ levels, opened }), [levels, opened])

  const toggle = (row: ContextRow): void => {
    if (!row.isDirectory) return
    const next = new Set(opened)
    if (next.has(row.path)) next.delete(row.path)
    else {
      next.add(row.path)
      loadRef.current(row.path)
    }
    setOpened({ channel, paths: next })
  }

  return {
    rows,
    status: contextStatusOf({ levels, rows: rows.length, connected: channel !== null }),
    toggle,
  }
}
