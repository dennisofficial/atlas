import { EExecutionLocation, EHarnessPlacement, EToolEnvironment, type ThreadId } from '@dltech/atlas-core'
import { useEffect } from 'react'
import { defaultExecutionLocation } from '@dltech/atlas-harness'

import { bornPlacementChip, startsTheThread } from './cloud/born-placement-chip'
import type { AtlasApp } from './compose'
import { useSessionOwner } from './use-session-owner'

export type ExecutionLocationControl = {
  location: EExecutionLocation
  bound: boolean
}

const HOST_PLACEMENT = { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host }

/**
 * The footer's location is read from the session's durable placement rather than held beside it:
 * the thread store owns where a session runs, so opening a conversation activates its record. The
 * settings default is only the fallback for a thread the store has never placed.
 *
 * A fresh, unsent thread (a new tile, or one that never ran `/new`) has no durable placement yet,
 * so nothing seeded the chip store — and the placement chip never rendered, even though the
 * placement is still choosable until the first send. Seed the chip the moment such a thread is
 * activated, and settle it (retire the chip, durably place the host) on the first send, the same
 * settle `placeOnFirstSend` runs for a born thread.
 */
export function useExecutionLocation(args: {
  app: AtlasApp
  threadId: ThreadId
  stored: EExecutionLocation | undefined
  started: boolean
}): ExecutionLocationControl {
  const { app, threadId, stored, started } = args

  const { location, bound } = useSessionOwner({ app })

  useEffect(() => app.executionLocation.subscribe(() => app.files.forget()), [app])

  useEffect(() => {
    const fallback =
      stored ?? defaultExecutionLocation({ settled: app.settings.snapshot().resolution })
    void app.sessionOwner.activateLocal({ threadId, fallback }).catch(() => undefined)
  }, [app, stored, threadId])

  useEffect(() => {
    if (started || app.pods) return
    const chip = bornPlacementChip(app)
    const held = chip.snapshot()
    if (held !== null && held.threadId === threadId) return
    const record = app.sessionOwner.placement.snapshot(threadId)
    if (record !== undefined && record.revision > 0) return

    chip.set({ threadId, harness: EHarnessPlacement.Host, provisioning: false })
    const stop = app.channel.subscribe({
      threadId,
      listener: (signal) => {
        if (!startsTheThread(signal)) return
        stop()
        bornPlacementChip(app).retire(threadId)
        const placed = app.sessionOwner.placement.snapshot(threadId)
        if (placed !== undefined && placed.placement.harness === EHarnessPlacement.Cloud) return
        void app.sessionOwner.placement
          .placeAtCreation({ threadId, placement: HOST_PLACEMENT })
          .catch(() => undefined)
      },
    })
    return stop
  }, [app, threadId, started])

  return { location, bound }
}
