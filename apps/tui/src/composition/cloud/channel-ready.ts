import { EConnectionView, type CloudConnection } from '@dltech/atlas-harness'

const TAKING_TURNS: ReadonlySet<EConnectionView> = new Set([
  EConnectionView.Connected,
  EConnectionView.Parked,
  EConnectionView.Waking,
  EConnectionView.Updating,
])

/**
 * A retry or resume re-drives the turn through the channel. A live socket carries it, and a
 * sandbox that is parked, waking, or updating takes it too — the send queues and the wake carries
 * it; a socket that dropped, gave up, or was left rejects.
 */
export function channelTakingTurns(
  connection: CloudConnection | null | undefined,
): boolean {
  const state = connection?.state
  return state === undefined || TAKING_TURNS.has(state)
}
