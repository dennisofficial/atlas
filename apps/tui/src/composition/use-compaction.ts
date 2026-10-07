import {
  ECompactionAnchor,
  type ThreadId,
} from '@dltech/atlas-core'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { Compacting } from '../ui/components/compacting'
import {
  ECompaction,
  ECompactScope,
  LocalCompaction,
  type Compaction,
} from '@dltech/atlas-harness'
import type { AtlasApp } from './compose'

const compactionCrashed = (fault: unknown): string =>
  `compacting the history did not finish: ${fault instanceof Error ? fault.message : String(fault)}`

export type CompactionControl = {
  compacting: Compacting | null
  compact: (scope: ECompactScope) => void
  compactAround: (args: { anchor: ECompactionAnchor; seq: number }) => void
  cancel: () => boolean
}

export function useCompaction(args: {
  app: AtlasApp
  threadId: ThreadId
  readClock: () => number
  refresh: () => Promise<void>
  onFailure: (reason: string) => void
  onCompacted: () => void
  frozen?: boolean | undefined
}): CompactionControl {
  const { app, threadId, readClock, refresh, onFailure, onCompacted } = args
  const [compacting, setCompacting] = useState<Compacting | null>(null)
  const compacter = useRef<AbortController | null>(null)
  const port = useMemo(
    () =>
      app.compaction ??
      new LocalCompaction({
        log: app.log,
        threads: app.threads,
        agents: app.agents,
        summarise: app.summarise,
      }),
    [app.agents, app.compaction, app.log, app.summarise, app.threads],
  )

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
      } catch (fault) {
        if (!controller.signal.aborted) onFailure(compactionCrashed(fault))
      } finally {
        compacter.current = null
        setCompacting(null)
      }
    },
    [onFailure, readClock, settle],
  )

  const frozen = args.frozen === true
  const compact = useCallback(
    (scope: ECompactScope) => {
      if (frozen) return
      void run((signal) => port.compact({ threadId, scope, signal }))
    },
    [frozen, port, run, threadId],
  )

  const compactAround = useCallback(
    (around: { anchor: ECompactionAnchor; seq: number }) => {
      if (frozen) return
      void run((signal) =>
        port.summarise({ threadId, anchor: around.anchor, seq: around.seq, signal }),
      )
    },
    [frozen, port, run, threadId],
  )

  const cancel = useCallback((): boolean => {
    const running = compacter.current
    if (running === null) return false

    setCompacting((current) => (current === null ? null : { ...current, cancelling: true }))
    running.abort()
    return true
  }, [])

  return { compacting, compact, compactAround, cancel }
}
