import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EExecutionLocation, projectOf, toThreadId } from '@dltech/atlas-core'
import type { ThreadStorePort, ThreadSummary } from '@dltech/atlas-harness'

import type { CloudSandboxes } from '@dltech/atlas-harness'
import { sandboxStatesFor } from './cloud/sandbox-states'

import {
  failedToList,
  loadingThreads,
  matchingThreads,
  threadRows,
  withChips,
  withSandboxStates,
  withThreads,
  type ThreadRow,
  type ThreadsState,
} from '../ui/threads-model'
import type { AtlasApp } from './compose'
import { openThreadChips, type ThreadChipsHandle } from './thread-chips'
import { routeThreadKey } from './thread-picker-keys'

export type ThreadsControl = {
  state: ThreadsState | null
  handleOpen: () => void
  handleDismiss: () => void
  handlePick: (row: ThreadRow) => void
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
  const chipsHandle = useRef<ThreadChipsHandle | null>(null)
  const decorated = useRef<Map<string, string>>(new Map())
  const enrichAsked = useRef<Set<string>>(new Set())

  const put = useCallback((next: ThreadsState | null) => {
    held.current = next
    setState(next)
  }, [])

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

  const paintChips = useCallback(
    (chips: Map<string, readonly import('../ui/threads-model').ThreadChip[]>, gen: number) => {
      if (generation.current !== gen) return
      const open = held.current
      if (open === null) return

      const cleared = [...chips.entries()].filter(([, held]) => held.length === 0)
      const filled = new Map([...chips.entries()].filter(([, held]) => held.length > 0))

      let next = open
      if (filled.size > 0) next = withChips({ state: next, chips: filled })
      if (cleared.length > 0) {
        const clearing = new Set(cleared.map(([threadId]) => threadId))
        next = {
          ...next,
          rows: next.rows.map((row) => {
            if (!clearing.has(row.threadId) || row.chips === undefined) return row
            const { chips: _dropped, ...rest } = row
            return rest
          }),
        }
      }
      if (next !== open) put(next)
    },
    [put],
  )

  const signatureOf = (row: ThreadRow): string =>
    `${row.worktree?.branch ?? ''}|${(row.pullRequests ?? []).map((link) => `${link.repo}#${link.number}`).join(',')}`

  const decorate = useCallback(
    (rows: readonly ThreadRow[], gen: number) => {
      const { pullRequests } = app

      if (pullRequests !== null) {
        if (chipsHandle.current === null) {
          chipsHandle.current = openThreadChips({
            home: app.config.cwd,
            pullRequests,
            onLanded: (chips) => paintChips(chips, gen),
          })
        }

        const current = held.current
        const visible =
          current === null
            ? rows
            : (() => {
                const matches = matchingThreads(current)
                const seen = new Set(
                  matches
                    .slice(Math.max(0, current.index - ENRICH_WINDOW), current.index + ENRICH_WINDOW + 1)
                    .map((row) => row.threadId),
                )
                return rows.filter((row) => seen.has(row.threadId))
              })()

        const due = visible.filter((row) => decorated.current.get(row.threadId) !== signatureOf(row))
        if (due.length > 0) {
          for (const row of due) decorated.current.set(row.threadId, signatureOf(row))
          paintChips(chipsHandle.current.sync({ rows: due }), gen)
        }
      }

      const cloudRows = rows.filter((row) => row.location === EExecutionLocation.Cloud)
      const sandboxes = findSandbox?.() ?? null
      const dueCloud = cloudRows.filter((row) => decorated.current.get(`sandbox:${row.threadId}`) === undefined)
      if (dueCloud.length === 0 || sandboxes === null) return

      for (const row of dueCloud) decorated.current.set(`sandbox:${row.threadId}`, 'asked')
      void sandboxStatesFor({ find: sandboxes, threadIds: dueCloud.map((row) => row.threadId) })
        .then((states) => {
          if (generation.current !== gen) return
          const open = held.current
          if (open === null) return

          put(withSandboxStates({ state: open, states }))
        })
        .catch(() => undefined)
    },
    [app, findSandbox, paintChips, put],
  )

  const adopt = useCallback(
    (threads: readonly ThreadSummary[], gen: number) => {
      if (generation.current !== gen) return
      const current = held.current
      if (current === null) return

      const rows = rebuildRows(threads, current)
      put(putRows(current, rows))
      decorate(rows, gen)
    },
    [decorate, put, putRows, rebuildRows],
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
          decorate(merged, gen)
        })
        .catch(() => undefined)
    },
    [activeThreadId, app, decorate, listing, put, putRows],
  )

  useEffect(() => {
    if (state === null) return
    enrichVisible(state)
  }, [state, enrichVisible])

  const handleOpen = useCallback(() => {
    generation.current += 1
    const gen = generation.current

    chipsHandle.current?.stop()
    chipsHandle.current = null
    decorated.current = new Map()
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
  }, [adopt, app, listing, put])

  const handleDismiss = useCallback(() => {
    generation.current += 1
    chipsHandle.current?.stop()
    chipsHandle.current = null
    put(null)
  }, [put])

  const handlePick = useCallback(
    (row: ThreadRow) => {
      generation.current += 1
      chipsHandle.current?.stop()
      chipsHandle.current = null
      put(null)
      onPick(row.threadId)
    },
    [onPick, put],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => routeThreadKey({ key, current: held.current, put, handleDismiss, handlePick }),
    [handleDismiss, handlePick, put],
  )

  return useMemo(
    () => ({ state, handleOpen, handleDismiss, handlePick, handleKey }),
    [handleDismiss, handleKey, handleOpen, handlePick, state],
  )
}
