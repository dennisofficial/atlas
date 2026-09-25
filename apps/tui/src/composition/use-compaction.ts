import {
  ECompactionAnchor,
  type ThreadId,
} from '@dltech/atlas-core'
import { useCallback, useRef, useState } from 'react'

import type { Compacting } from '../ui/components/compacting'
import {
  compactTurn,
  ECompaction,
  ECompactScope,
  summariseAt,
  type Compaction,
} from '@dltech/atlas-harness'
import type { AtlasApp } from './compose'

const COMPACTION_CRASHED = 'compacting the history did not finish, so nothing was changed'

export type CompactionControl = {
  compacting: Compacting | null
  compact: (scope: ECompactScope) => void
  compactAround: (args: { anchor: ECompactionAnchor; seq: number }) => void
  cancel: () => boolean
}

/**
 * The operator-facing half of compaction: the pill state, the esc cancel, and the two explicit
 * commands (/compact, prune-at). The between-turns decision no longer lives here — the harness's
 * turn policy fires it for every session kind and this surface observes it through the log.
 */
export function useCompaction(args: {
  app: AtlasApp
  threadId: ThreadId
  readClock: () => number
  refresh: () => Promise<void>
  onFailure: (reason: string) => void
  onCompacted: () => void
}): CompactionControl {
  const { app, threadId, readClock, refresh, onFailure, onCompacted } = args
  const [compacting, setCompacting] = useState<Compacting | null>(null)
  const compacter = useRef<AbortController | null>(null)

  const settle = useCallback(
    async (compaction: Compaction) => {
      if (compaction.type === ECompaction.Refused) {
        onFailure(compaction.reason)
        return
      }
      if (compaction.type === ECompaction.Nothing) return

      onCompacted()
      await refresh()
    },
    [onCompacted, onFailure, refresh],
  )

  const run = useCallback(
    async (start: (signal: AbortSignal) => Promise<Compaction>): Promise<void> => {
      if (compacter.current !== null) return

      const controller = new AbortController()
      compacter.current = controller
      setCompacting({ startedAt: readClock(), cancelling: false })

      try {
        const outcome = await start(controller.signal)
        if (!controller.signal.aborted) await settle(outcome)
      } catch {
        if (!controller.signal.aborted) onFailure(COMPACTION_CRASHED)
      } finally {
        compacter.current = null
        setCompacting(null)
      }
    },
    [onFailure, readClock, settle],
  )

  const compact = useCallback(
    (scope: ECompactScope) =>
      void run((signal) =>
        compactTurn({
          log: app.log,
          threads: app.threads,
          agents: app.agents,
          threadId,
          scope,
          summarise: app.summarise,
          signal,
        }),
      ),
    [app.agents, app.log, app.summarise, app.threads, run, threadId],
  )

  const compactAround = useCallback(
    (around: { anchor: ECompactionAnchor; seq: number }) =>
      void run((signal) =>
        summariseAt({
          log: app.log,
          threads: app.threads,
          agents: app.agents,
          threadId,
          anchor: around.anchor,
          seq: around.seq,
          summarise: app.summarise,
          signal,
        }),
      ),
    [app.agents, app.log, app.summarise, app.threads, run, threadId],
  )

  /**
   * Interrupting a compaction is not interrupting a turn, and the operator pressed one key for
   * both — so this answers whether it took the press.
   */
  const cancel = useCallback((): boolean => {
    const running = compacter.current
    if (running === null) return false

    setCompacting((current) => (current === null ? null : { ...current, cancelling: true }))
    running.abort()
    return true
  }, [])

  return { compacting, compact, compactAround, cancel }
}
