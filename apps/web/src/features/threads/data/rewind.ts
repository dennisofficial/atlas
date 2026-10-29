import {
  agentLabel,
  rewindPlan,
  rewindTarget,
  type Event,
  type RewindCut,
} from '@dltech/atlas-core'
import {
  EAgentStatus,
  EServiceStatus,
  EShellStatus,
  type RewindCutWire,
  type RosterWire,
} from '@dltech/atlas-wire/web'

export type RewindKillRow = {
  kind: 'agent' | 'shell' | 'service'
  label: string
  running: boolean
}

export type RewindPlanView =
  | {
      kind: 'ok'
      toSeq: number
      cuts: readonly RewindCutWire[]
      cutAgents: string[]
      kills: RewindKillRow[]
    }
  | { kind: 'refused'; reason: string }

const optional = (args: { command: string | undefined; description: string | undefined }) => ({
  ...(args.command === undefined ? {} : { command: args.command }),
  ...(args.description === undefined ? {} : { description: args.description }),
})

const cutWireOf = (cut: RewindCut): RewindCutWire => {
  if (cut.kind === 'agent') {
    return {
      kind: cut.kind,
      agentId: cut.agentId,
      agentType: cut.agentType,
      intent: cut.intent,
    }
  }
  if (cut.kind === 'shell') return { kind: cut.kind, shellId: cut.shellId, ...optional(cut) }
  return { kind: cut.kind, serviceId: cut.serviceId, ...optional(cut) }
}

const processLabel = (args: { id: string; command: string | undefined }): string =>
  args.command?.replace(/\s+/g, ' ').trim() || args.id

const killRowOf = (args: { cut: RewindCut; roster: RosterWire | null }): RewindKillRow => {
  const { cut, roster } = args
  if (cut.kind === 'agent') {
    const live = roster?.agents.find((agent) => agent.agentId === cut.agentId)
    return {
      kind: 'agent',
      label: agentLabel({ agentType: cut.agentType, intent: cut.intent }),
      running: live?.status === EAgentStatus.Running,
    }
  }
  if (cut.kind === 'shell') {
    const live = roster?.shells.find((shell) => shell.shellId === cut.shellId)
    return {
      kind: 'shell',
      label: processLabel({
        id: cut.shellId,
        command: live?.command ?? cut.command,
      }),
      running: live?.status === EShellStatus.Running,
    }
  }
  const live = roster?.services.find((service) => service.serviceId === cut.serviceId)
  return {
    kind: 'service',
    label: processLabel({
      id: cut.serviceId,
      command: live?.command ?? cut.command,
    }),
    running: live?.status === EServiceStatus.Running,
  }
}

export function planRewind(args: {
  events: readonly Event[]
  toSeq: number
  roster: RosterWire | null
}): RewindPlanView {
  const { events, toSeq, roster } = args
  const target = rewindTarget({ events, toSeq })
  if (!target.allowed) return { kind: 'refused', reason: target.reason }
  const { cuts } = rewindPlan({ events, toSeq })
  return {
    kind: 'ok',
    toSeq,
    cuts: cuts.map(cutWireOf),
    cutAgents: cuts.flatMap((cut) => (cut.kind === 'agent' ? [cut.agentId] : [])),
    kills: cuts.map((cut) => killRowOf({ cut, roster })),
  }
}

export function userRewindPoints(events: readonly Event[]): Map<string, number> {
  return new Map(
    events.flatMap((event) =>
      event.type === 'user-said' && event.seq >= 1 ? [[event.id, event.seq - 1] as const] : [],
    ),
  )
}
