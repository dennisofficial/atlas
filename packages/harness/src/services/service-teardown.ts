import { EServiceStatus, type EKilledBy } from '@dltech/atlas-core'

import type { TrackedService } from './service-endings'
import { diedWithin, within } from './service-registry-support'

export const CLOSE_GRACE_MS = 300
export const KILLED_GRACE_MS = 5_000

/** The escalation window plus slack: a stop that outlives this is handed back to the announcement path. */
export const STOP_SETTLE_MS = KILLED_GRACE_MS + 2_000

export async function awaitServiceEndings({
  entries,
  ms,
}: {
  entries: readonly TrackedService[]
  ms: number
}): Promise<number> {
  const signalled = entries.filter(
    (entry) => entry.service.snapshot().status !== EServiceStatus.Running,
  )
  const deaths = await Promise.all(
    signalled.map((entry) =>
      diedWithin(
        ms,
        entry.service.exited.then(() => entry.ending),
      ),
    ),
  )
  return deaths.filter((died) => !died).length
}

/**
 * Teardown stops everything but suppresses nothing: every ending is recorded to its thread's log
 * before this resolves, and a recording that failed gets one more attempt.
 */
export async function stopAllServices({
  entries,
  killedBy,
  retry,
}: {
  entries: readonly TrackedService[]
  killedBy: EKilledBy
  retry: () => Promise<void>
}): Promise<void> {
  for (const entry of entries) entry.service.stop(killedBy)
  await Promise.all(entries.map((entry) => within(CLOSE_GRACE_MS, entry.service.exited)))
  for (const entry of entries) entry.service.stop(killedBy)
  await Promise.all(entries.map((entry) => within(KILLED_GRACE_MS, entry.service.exited)))
  await within(KILLED_GRACE_MS, Promise.all(entries.map((entry) => entry.ending)))
  await within(KILLED_GRACE_MS, retry())
}
