import { useCallback, useRef, type RefObject } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import type { CloudSandboxes } from '@dltech/atlas-harness'

import {
  matchingThreads,
  withChips,
  withSandboxStates,
  type ThreadChip,
  type ThreadRow,
  type ThreadsState,
} from '../ui/threads-model'
import { sandboxStatesFor } from './cloud/sandbox-states'
import type { AtlasApp } from './compose'
import { openThreadChips, type ThreadChipsHandle } from './thread-chips'

const ENRICH_WINDOW = 8

export type ThreadDecorator = {
  decorate: (rows: readonly ThreadRow[]) => void
  stop: () => void
  reset: () => void
}

const signatureOf = (row: ThreadRow): string =>
  `${row.worktree?.branch ?? ''}|${(row.pullRequests ?? []).map((link) => `${link.repo}#${link.number}`).join(',')}`

/**
 * Badges and sandbox liveness trail the listing: each attaches in a second pass keyed by thread,
 * and a second generation (a reopen, a dismiss, a pick) voids whatever the first still had in
 * flight.
 */
export function useThreadDecorator(args: {
  app: AtlasApp
  held: RefObject<ThreadsState | null>
  generation: RefObject<number>
  findSandbox: (() => Pick<CloudSandboxes, 'find'> | null) | undefined
  put: (next: ThreadsState | null) => void
}): ThreadDecorator {
  const { app, held, generation, findSandbox, put } = args
  const chipsHandle = useRef<ThreadChipsHandle | null>(null)
  const decorated = useRef<Map<string, string>>(new Map())

  const paintChips = useCallback(
    (chips: Map<string, readonly ThreadChip[]>, gen: number) => {
      if (generation.current !== gen) return
      const open = held.current
      if (open === null) return

      const cleared = [...chips.entries()].filter(([, landed]) => landed.length === 0)
      const filled = new Map([...chips.entries()].filter(([, landed]) => landed.length > 0))

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
    [generation, held, put],
  )

  const decorate = useCallback(
    (rows: readonly ThreadRow[]) => {
      const gen = generation.current
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
    [app, findSandbox, generation, held, paintChips, put],
  )

  const stop = useCallback(() => {
    chipsHandle.current?.stop()
    chipsHandle.current = null
  }, [])

  const reset = useCallback(() => {
    stop()
    decorated.current = new Map()
  }, [stop])

  return { decorate, stop, reset }
}
