import type { ThreadId } from '@dltech/atlas-core'
import { rosterWireSchema, type RosterWire } from '@dltech/atlas-wire'

import type { AgentSnapshot } from '../agents/registry/snapshot'
import type { ServiceSnapshot } from '../services/service-process'
import type { ShellSnapshot } from '../shells/background-shell'
import { EClientRequest } from './channel-wire'
import { RemoteRequestFailed } from './remote-channel-upstream'

export const EMPTY_ROSTER: RosterWire = { shells: [], agents: [], services: [] }

/**
 * The read shape a cloud-attached surface polls: the channel's answer to a list-roster request,
 * re-asked every time a roster push lands. A serve older than the op refuses the request, and a
 * refused roster is an empty one — the pre-roster behaviour — never an error the surface sees.
 */
export type RemoteRosterReader = {
  roster(): Promise<RosterWire>
  onChange(listener: () => void): () => void
}

type RosterChannel = {
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  onRoster(listener: (roster: RosterWire) => void): () => void
  onReload(listener: () => void): () => void
  onReady(listener: () => void): () => void
}

export function createRemoteRosterReader(args: { channel: RosterChannel }): RemoteRosterReader {
  const { channel } = args
  const listeners = new Set<() => void>()
  let unsubscribeChannel: (() => void) | null = null
  const poke = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const attach = (): void => {
    if (unsubscribeChannel !== null) return
    const offs = [
      channel.onRoster(() => poke()),
      // A reload means the client re-read the log against a serve that may have restarted; whatever
      // roster it held is just as stale.
      channel.onReload(() => poke()),
      // A ready means the socket just re-attached: every roster push fired while it was down is
      // gone for good, so the held snapshot re-answers against the live registries.
      channel.onReady(() => poke()),
    ]
    unsubscribeChannel = () => {
      for (const off of offs) off()
    }
  }

  const detach = (): void => {
    unsubscribeChannel?.()
    unsubscribeChannel = null
  }

  return {
    async roster(): Promise<RosterWire> {
      try {
        return rosterWireSchema.parse(
          await channel.request({ op: EClientRequest.ListRoster, params: {} }),
        )
      } catch (error) {
        if (error instanceof RemoteRequestFailed) return EMPTY_ROSTER
        throw error
      }
    },

    onChange(listener) {
      listeners.add(listener)
      attach()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) detach()
      }
    },
  }
}

export const rosterShells = (args: {
  roster: RosterWire
  threadId: ThreadId
}): readonly ShellSnapshot[] =>
  args.roster.shells.filter((shell) => shell.threadId === args.threadId)

const toAgentSnapshot = (wire: RosterWire['agents'][number]): AgentSnapshot => ({
  agentId: wire.agentId,
  spawnedBy: wire.spawnedBy,
  agentType: wire.agentType,
  intent: wire.intent,
  status: wire.status,
  ...(wire.killedBy === undefined ? {} : { killedBy: wire.killedBy }),
  turns: wire.turns,
  toolCalls: wire.toolCalls,
  lastTool: wire.lastTool as string | undefined,
  startedAt: wire.startedAt,
  ...(wire.steppingSince === undefined ? {} : { steppingSince: wire.steppingSince }),
  endedAt: wire.endedAt,
  ...(wire.deliveredAt === undefined ? {} : { deliveredAt: wire.deliveredAt }),
  ...(wire.context === undefined ? {} : { context: wire.context }),
  ...(wire.model === undefined ? {} : { model: wire.model }),
})

export const rosterAgents = (args: {
  roster: RosterWire
  threadId: ThreadId
}): readonly AgentSnapshot[] =>
  args.roster.agents.filter((agent) => agent.spawnedBy === args.threadId).map(toAgentSnapshot)

export const rosterServices = (roster: RosterWire): readonly ServiceSnapshot[] =>
  roster.services
