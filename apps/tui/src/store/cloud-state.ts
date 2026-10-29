import type { ERunner } from '@dltech/atlas-core'
import { EConnectionView, type ConnectionView } from '@dltech/atlas-harness'

export type SidebarCloud = { state: EConnectionView; runner?: ERunner | undefined }

const RESTING: ReadonlySet<EConnectionView> = new Set([
  EConnectionView.Waking,
  EConnectionView.Reconnecting,
  EConnectionView.Updating,
  EConnectionView.Parked,
])

/** Parked is where a cloud session spends most of its life, so it is never drawn as a fault. */
export const isResting = (state: EConnectionView): boolean => RESTING.has(state)

export function cloudPillOf(args: {
  connection: ConnectionView | null
  runner?: ERunner | undefined
}): SidebarCloud | null {
  if (args.connection === null) return null
  if (args.connection.state === EConnectionView.Detached) return null

  return {
    state: args.connection.state,
    ...(args.runner === undefined ? {} : { runner: args.runner }),
  }
}
