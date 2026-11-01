'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CONTEXT_API_POLL_MS,
  listContextFilesFromApi,
  watchContextFiles,
  type ContextLevel,
} from './context-files-source'
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

export function useContextFiles(args: {
  threadId: string
  channel: ServeChannel | null
}): ContextFiles {
  const { threadId, channel } = args
  type SourceKey = ServeChannel | 'api'
  const [held, setHeld] = useState<{
    key: SourceKey | null
    levels: ContextLevels
  } | null>(null)
  const sourceKey: SourceKey = channel ?? 'api'
  const levels = held !== null && held.key === sourceKey ? held.levels : NO_LEVELS
  const [openedState, setOpened] = useState<{
    key: SourceKey | null
    paths: ReadonlySet<string>
  }>({ key: null, paths: NONE })
  const opened = openedState.key === sourceKey ? openedState.paths : NONE
  const loadRef = useRef<(directory: string) => void>(() => undefined)

  useEffect(() => {
    if (channel !== null) {
      const watch = watchContextFiles({
        channel,
        onLevel: ({ directory, level }) =>
          setHeld((current) => {
            const base = current !== null && current.key === channel ? current.levels : NO_LEVELS
            return {
              key: channel,
              levels: new Map<string, ContextLevel>(base).set(directory, level),
            }
          }),
      })
      loadRef.current = watch.load
      return watch.stop
    }

    let active = true
    const known = new Set<string>([''])
    const loadDirectory = (directory: string): void => {
      known.add(directory)
      void listContextFilesFromApi({
        threadId,
        directory: directory === '' ? undefined : directory,
      }).then((level) => {
        if (!active) return
        setHeld((current) => {
          const base = current !== null && current.key === 'api' ? current.levels : NO_LEVELS
          return { key: 'api', levels: new Map<string, ContextLevel>(base).set(directory, level) }
        })
      })
    }
    const refresh = (): void => {
      for (const directory of known) loadDirectory(directory)
    }
    loadRef.current = loadDirectory
    loadDirectory('')
    const interval = setInterval(refresh, CONTEXT_API_POLL_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [channel, threadId])

  const rows = useMemo(() => contextRowsOf({ levels, opened }), [levels, opened])

  const toggle = (row: ContextRow): void => {
    if (!row.isDirectory) return
    const next = new Set(opened)
    if (next.has(row.path)) next.delete(row.path)
    else {
      next.add(row.path)
      loadRef.current(row.path)
    }
    setOpened({ key: sourceKey, paths: next })
  }

  return {
    rows,
    status: contextStatusOf({ levels, rows: rows.length, connected: true }),
    toggle,
  }
}
