import { isTeammateType } from '../agents/kind'
import type { Event } from './envelope'
import type { ThreadId } from './ids'

/**
 * A thread that inherits a prefix by reference reads rows belonging to its parent. Control flow —
 * what is pending, what is unapproved, whose turn it is — must only ever consider the rows the
 * thread itself owns, or a child pauses on a call it never made. Assembly reads the composed list,
 * because inherited context is the point of inheriting.
 */
export function rowsOwnedBy(args: {
  events: readonly Event[]
  threadId: ThreadId
}): readonly Event[] {
  return args.events.filter((event) => event.threadId === args.threadId)
}

export enum EOwnedUnitKind {
  Shell = 'shell',
  Service = 'service',
  Agent = 'agent',
}

export type LiveShell = {
  kind: EOwnedUnitKind.Shell
  shellId: string
  startedSeq: number
}

export type LiveService = {
  kind: EOwnedUnitKind.Service
  serviceId: string
  startedSeq: number
}

export type LiveAgent = {
  kind: EOwnedUnitKind.Agent
  agentId: ThreadId
  isTeammate: boolean
  startedSeq: number
}

export type LiveOwnedUnit = LiveShell | LiveService | LiveAgent

export type LiveOwnedUnits = {
  shells: readonly LiveShell[]
  services: readonly LiveService[]
  agents: readonly LiveAgent[]
}

export function liveOwnedUnits(events: readonly Event[]): LiveOwnedUnits {
  const shells = new Map<string, LiveShell>()
  const services = new Map<string, LiveService>()
  const agents = new Map<ThreadId, LiveAgent>()

  for (const event of events) {
    switch (event.type) {
      case 'background-shell-started':
        shells.set(event.shellId, {
          kind: EOwnedUnitKind.Shell,
          shellId: event.shellId,
          startedSeq: event.seq,
        })
        break
      case 'background-shell-ended':
        shells.delete(event.shellId)
        break
      case 'service-started':
        services.set(event.serviceId, {
          kind: EOwnedUnitKind.Service,
          serviceId: event.serviceId,
          startedSeq: event.seq,
        })
        break
      case 'service-ended':
        services.delete(event.serviceId)
        break
      case 'agent-spawned':
        agents.set(event.agentId, {
          kind: EOwnedUnitKind.Agent,
          agentId: event.agentId,
          isTeammate: isTeammateType(event.agentType),
          startedSeq: event.seq,
        })
        break
      case 'agent-ended':
        agents.delete(event.agentId)
        break
      default:
        break
    }
  }

  return {
    shells: [...shells.values()],
    services: [...services.values()],
    agents: [...agents.values()],
  }
}
