import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { projectOf, toThreadId } from '@dltech/atlas-core'
import type { CloudSandboxes, ThreadStorePort, ThreadSummary } from '@dltech/atlas-harness'

import {
  failedToList,
  loadingThreads,
  matchingThreads,
  moveSelection,
  selectedThread,
  threadRows,
  withThreads,
  type ThreadRow,
  type ThreadsState,
} from '../ui/threads-model'
import type { AtlasApp } from './compose'
import { useThreadDecorator } from './use-thread-decorator'

export type ThreadsControl = {
  state: ThreadsState | null
  handleOpen: () => void
  handleDismiss: () => void
  handlePick: (row: ThreadRow) => void
  handleQuery: (query: string) => void
  handleKey: (key: KeyEvent) => void
}

const ENRICH_WINDOW = 8

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the conversations could not be listed'

/**
 * OpenTUI parses a whole input burst before React re-renders, so a typed run of keys would all read
 * the same rendered state. The ref is what the handlers read and write; React state draws it.
 */
export function useThreads(args: {
  app: AtlasApp
  activeThreadId: string
  onPick: (threadId: string) => void
  listing?: (() => Pick<ThreadStorePort, 'list'>) | undefined
  findSandbox?: (() => Pick<CloudSandboxes, 'find'> | null) | undefined
}): ThreadsControl {
  const { app, activeThreadId, onPick, listing, findSandbox } = args
  const held = useRef<ThreadsState | null>(null)
  const [state, setState] = useState<ThreadsState | null>(null)

  const generation = useRef(0)
  const enrichAsked = useRef<Set<string>>(new Set())

  const put = useCallback((next: ThreadsState | null) => {
    held.current = next
    setState(next)
  }, [])

  const decorator = useThreadDecorator({ app, held, generation, findSandbox, put })

  const rebuildRows = useCallback(
    (threads: readonly ThreadSummary[], current: ThreadsState): ThreadRow[] => {
      const decorations = new Map(current.rows.map((row) => [row.threadId, row]))
      return threadRows({ threads, activeThreadId }).map((row) => {
        const held = decorations.get(row.threadId)
        return {
          ...row,
          ...(held?.chips === undefined ? {} : { chips: held.chips }),
          ...(held?.sandbox === undefined ? {} : { sandbox: held.sandbox }),
        }
      })
    },
    [activeThreadId],
  )

  const putRows = useCallback(
    (current: ThreadsState, rows: readonly ThreadRow[]): ThreadsState => {
      const selected = matchingThreads(current)[current.index]?.threadId
      const selectedIndex = selected === undefined ? -1 : rows.findIndex((row) => row.threadId === selected)
      const next = withThreads({ state: current, rows })
      return selectedIndex >= 0 ? { ...next, index: selectedIndex } : next
    },
    [],
  )

  const adopt = useCallback(
    (threads: readonly ThreadSummary[], gen: number) => {
      if (generation.current !== gen) return
      const current = held.current
      if (current === null) return

      const rows = rebuildRows(threads, current)
      put(putRows(current, rows))
      decorator.decorate(rows)
    },
    [decorator, put, putRows, rebuildRows],
  )

  const enrichVisible = useCallback(
    (current: ThreadsState) => {
      if (current.loading) return

      const gen = generation.current
      const window = matchingThreads(current).slice(
        Math.max(0, current.index - ENRICH_WINDOW),
        current.index + ENRICH_WINDOW + 1,
      )
      const wanted = window
        .filter((row) => row.pullRequests === undefined)
        .map((row) => row.threadId)
        .filter((id) => !enrichAsked.current.has(id))
      if (wanted.length === 0) return

      for (const id of wanted) enrichAsked.current.add(id)
      const source = listing?.() ?? app.threads
      void source
        .list({
          project: projectOf(app.workspace),
          limit: Number.POSITIVE_INFINITY,
          enrich: wanted.map((id) => toThreadId(id)),
        })
        .then((threads) => {
          if (generation.current !== gen) return
          const open = held.current
          if (open === null) return

          const byId = new Map(threads.map((thread) => [String(thread.id), thread]))
          let changed = false
          const merged = open.rows.map((row) => {
            const enriched = byId.get(row.threadId)
            if (enriched === undefined) return row
            if (enriched.pullRequests === undefined && enriched.worktree === undefined) return row

            const rebuilt = threadRows({ threads: [enriched], activeThreadId })[0]
            if (rebuilt === undefined) return row
            changed = true
            return {
              ...rebuilt,
              ...(row.chips === undefined ? {} : { chips: row.chips }),
              ...(row.sandbox === undefined ? {} : { sandbox: row.sandbox }),
            }
          })
          if (!changed) return

          put(putRows(open, merged))
          decorator.decorate(merged)
        })
        .catch(() => undefined)
    },
    [activeThreadId, app, decorator, listing, put, putRows],
  )

  useEffect(() => {
    if (state === null) return
    enrichVisible(state)
  }, [state, enrichVisible])

  const handleOpen = useCallback(() => {
    generation.current += 1
    const gen = generation.current

    decorator.reset()
    enrichAsked.current = new Set()

    put(loadingThreads({ now: Date.now() }))

    const source = listing?.() ?? app.threads
    source
      .list({
        project: projectOf(app.workspace),
        limit: Number.POSITIVE_INFINITY,
        onUpdate: (threads) => adopt(threads, gen),
      })
      .then((threads) => adopt(threads, gen))
      .catch((error: unknown) => {
        if (generation.current !== gen) return
        const current = held.current
        if (current === null) return

        put(failedToList({ state: current, reason: reasonOf(error) }))
      })
  }, [adopt, app, decorator, listing, put])

  const handleDismiss = useCallback(() => {
    generation.current += 1
    decorator.stop()
    put(null)
  }, [decorator, put])

  const handlePick = useCallback(
    (row: ThreadRow) => {
      generation.current += 1
      decorator.stop()
      put(null)
      onPick(row.threadId)
    },
    [decorator, onPick, put],
  )

  /**
   * The filter field is a real input, so editing reaches the query through its change events.
   * What remains here is only what the field does not own: dismiss, open, and selection motion.
   */
  const handleQuery = useCallback(
    (query: string) => {
      const current = held.current
      if (current === null) return
      put({ ...current, query, index: 0, failure: null })
    },
    [put],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      const current = held.current
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
      }
    },
    [handleDismiss, handlePick, put],
  )

  return useMemo(
    () => ({ state, handleOpen, handleDismiss, handlePick, handleQuery, handleKey }),
    [handleDismiss, handleKey, handleOpen, handlePick, handleQuery, state],
  )
}
