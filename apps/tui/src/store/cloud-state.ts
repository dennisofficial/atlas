import { EChannelConnection, type ChannelConnection } from '@dltech/atlas-harness'

export type SidebarCloud = { state: EChannelConnection; detail: string | null }

const RESTING: ReadonlySet<EChannelConnection> = new Set([
  EChannelConnection.Connecting,
  EChannelConnection.Reconnecting,
  EChannelConnection.Parked,
])

/** Parked is where a cloud session spends most of its life, so it is never drawn as a fault. */
export const isResting = (state: EChannelConnection): boolean => RESTING.has(state)

export function cloudPillOf(args: { connection: ChannelConnection | null }): SidebarCloud | null {
  if (args.connection === null) return null

  return { state: args.connection.state, detail: args.connection.detail }
}
