import type { CloudConnection } from '@dltech/atlas-harness'
import { EChannelConnection } from '@dltech/atlas-harness'

/**
 * A retry or resume re-drives the turn through the channel. Only an open socket carries it, and a
 * parked sandbox wakes on demand (remote-delta-channel queues a wake); everything else rejects.
 */
export function channelTakingTurns(
  connection: CloudConnection | null | undefined,
): boolean {
  const state = connection?.state
  return (
    state === undefined ||
    state === EChannelConnection.Open ||
    state === EChannelConnection.Parked
  )
}
