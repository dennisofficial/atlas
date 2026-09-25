import type { ThreadId } from '@dltech/atlas-core'
import type { RosterWire } from '@dltech/atlas-wire'
import {
  createRemoteRosterReader,
  EMPTY_ROSTER,
  rosterAgents,
  rosterShells,
  type AgentSnapshot,
  type RemoteRosterReader,
  type ShellSnapshot,
} from '@dltech/atlas-harness'

export { EMPTY_ROSTER }

/**
 * The one poll behind every remote registry: the channel answers list-roster, and a push (or a
 * reload, which says the held answer is stale) asks again. Fires the listener only when the roster
 * actually changed, so a push that re-states what is already held does not redraw the surfaces.
 */
export type SharedRoster = {
  current(): RosterWire
  version(): number
  subscribe(listener: () => void): () => void
}

const sameRoster = (left: RosterWire, right: RosterWire): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export function createSharedRoster(reader: RemoteRosterReader): SharedRoster {
  let held: RosterWire = EMPTY_ROSTER
  let revision = 0
  const listeners = new Set<() => void>()

  const refresh = async (): Promise<void> => {
    const latest = await reader.roster().catch(() => held)
    if (sameRoster(held, latest)) return

    held = latest
    revision += 1
    for (const listener of [...listeners]) listener()
  }

  reader.onChange(() => void refresh())
  void refresh()

  return {
    current: () => held,
    version: () => revision,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export const shellsFor = (args: {
  roster: RosterWire
  threadId: ThreadId
}): readonly ShellSnapshot[] => rosterShells(args)

export const agentsFor = (args: {
  roster: RosterWire
  threadId: ThreadId
}): readonly AgentSnapshot[] => rosterAgents(args)

const sameSnapshots = <T extends object>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length &&
  left.every((one, index) => {
    const other = right[index]
    return other !== undefined && JSON.stringify(one) === JSON.stringify(other)
  })

export const heldIfSame = <T extends object>(
  current: readonly T[],
  latest: readonly T[],
): readonly T[] => (sameSnapshots(current, latest) ? current : latest)
