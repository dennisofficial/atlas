import { EAgentStatus } from './status'

export type CrewMember = {
  agentId: string
  spawnedBy: string
  status: EAgentStatus
  deliveredAt: string | null
  lastViewedAt: string | null
  holdingShells?: boolean | undefined
  waitingOn?: string | undefined
  hasOpenPullRequest?: boolean | undefined
}

/**
 * `Live` is a child still working, `Held` one that has ended but is pinned open by something the
 * operator has not yet seen through, and `Settled` one nothing depends on — the only standing the
 * sidebar may collapse. Nothing leaves the panel: a settled row folds behind its tier's count.
 */
export enum ECrewStanding {
  Live = 'live',
  Held = 'held',
  Settled = 'settled',
}

const IS_TERMINAL: Record<EAgentStatus, boolean> = {
  [EAgentStatus.Running]: false,
  [EAgentStatus.Blocked]: false,
  [EAgentStatus.Finished]: true,
  [EAgentStatus.Failed]: true,
  [EAgentStatus.Stopped]: true,
  [EAgentStatus.Paused]: false,
  [EAgentStatus.WaitingForModel]: false,
}

const NEEDS_ACKNOWLEDGING: Record<EAgentStatus, boolean> = {
  [EAgentStatus.Running]: false,
  [EAgentStatus.Blocked]: false,
  [EAgentStatus.Finished]: false,
  [EAgentStatus.Failed]: true,
  [EAgentStatus.Stopped]: true,
  [EAgentStatus.Paused]: false,
  [EAgentStatus.WaitingForModel]: false,
}

const ancestorsOfLive = (crew: readonly CrewMember[]): ReadonlySet<string> => {
  const parentOf = new Map<string, string>()
  for (const member of crew) parentOf.set(member.agentId, member.spawnedBy)

  const holding = new Set<string>()
  for (const member of crew) {
    if (IS_TERMINAL[member.status]) continue

    let ancestor = parentOf.get(member.agentId)
    while (ancestor !== undefined && !holding.has(ancestor)) {
      holding.add(ancestor)
      ancestor = parentOf.get(ancestor)
    }
  }

  return holding
}

const standingOf = (args: {
  member: CrewMember
  holdingLive: ReadonlySet<string>
  viewing: string | null
}): ECrewStanding => {
  const { member } = args
  if (!IS_TERMINAL[member.status]) return ECrewStanding.Live
  if (member.holdingShells === true) return ECrewStanding.Held
  if (member.waitingOn !== undefined) return ECrewStanding.Held
  if (member.deliveredAt === null) return ECrewStanding.Held
  if (member.agentId === args.viewing) return ECrewStanding.Held
  if (args.holdingLive.has(member.agentId)) return ECrewStanding.Held
  if (member.hasOpenPullRequest === true) return ECrewStanding.Held
  if (member.lastViewedAt === null && NEEDS_ACKNOWLEDGING[member.status]) return ECrewStanding.Held

  return ECrewStanding.Settled
}

export function crewStanding(args: {
  member: CrewMember
  crew: readonly CrewMember[]
  viewing: string | null
}): ECrewStanding {
  return standingOf({
    member: args.member,
    holdingLive: ancestorsOfLive(args.crew),
    viewing: args.viewing,
  })
}

export function standingsOfCrew(args: {
  crew: readonly CrewMember[]
  viewing: string | null
}): ReadonlyMap<string, ECrewStanding> {
  const holdingLive = ancestorsOfLive(args.crew)
  const standings = new Map<string, ECrewStanding>()

  for (const member of args.crew) {
    standings.set(member.agentId, standingOf({ member, holdingLive, viewing: args.viewing }))
  }

  return standings
}
