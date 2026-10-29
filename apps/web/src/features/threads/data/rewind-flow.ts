import type { Event } from '@dltech/atlas-core'
import type { EPodState, RewindCutWire, RosterWire } from '@dltech/atlas-wire/web'

import {
  ERewindRoute,
  planRewind,
  rewindRouteOf,
  userRewindPoints,
  type RewindKillRow,
} from './rewind'

export const REWIND_WAITS_FOR_TURN =
  'Rewind has to wait for this turn — pick the point again when it settles'
export const REWIND_WAITS_FOR_SANDBOX =
  'The sandbox is reconnecting — pick the point again once it is live'

export type RewindPick = {
  route: ERewindRoute.Live | ERewindRoute.Offline
  toSeq: number
  text: string
  cuts: readonly RewindCutWire[]
  cutAgents: string[]
  kills: RewindKillRow[]
}

export enum ERewindDecision {
  Warn = 'warn',
  Refuse = 'refuse',
  Confirm = 'confirm',
  Apply = 'apply',
  Ignore = 'ignore',
}

export type RewindDecision =
  | { kind: ERewindDecision.Warn; message: string }
  | { kind: ERewindDecision.Refuse; message: string }
  | { kind: ERewindDecision.Confirm; pick: RewindPick }
  | { kind: ERewindDecision.Apply; pick: RewindPick }
  | { kind: ERewindDecision.Ignore }

export type RewindSituation = {
  threadId: string
  events: readonly Event[]
  live: boolean
  working: boolean
  podState: EPodState | null
}

export function rewindRouteFor(situation: RewindSituation): ERewindRoute {
  return rewindRouteOf({
    live: situation.live,
    working: situation.working,
    podState: situation.podState,
  })
}

export function decideRewind(args: {
  situation: RewindSituation
  eventId: string
  text: string
  roster: RosterWire | null
}): RewindDecision {
  const { situation } = args
  const route = rewindRouteFor(situation)
  if (route === ERewindRoute.WaitForTurn) {
    return { kind: ERewindDecision.Warn, message: REWIND_WAITS_FOR_TURN }
  }
  if (route === ERewindRoute.Reconnecting) {
    return { kind: ERewindDecision.Warn, message: REWIND_WAITS_FOR_SANDBOX }
  }
  const toSeq = userRewindPoints(situation.events).get(args.eventId)
  if (toSeq === undefined) return { kind: ERewindDecision.Ignore }
  const plan = planRewind({
    events: situation.events,
    toSeq,
    roster: args.roster,
    threadId: situation.threadId,
  })
  if (plan.kind === 'refused') return { kind: ERewindDecision.Refuse, message: plan.reason }
  const pick: RewindPick = {
    route,
    toSeq: plan.toSeq,
    text: args.text,
    cuts: plan.cuts,
    cutAgents: plan.cutAgents,
    kills: plan.kills,
  }
  if (pick.kills.length > 0) return { kind: ERewindDecision.Confirm, pick }
  return { kind: ERewindDecision.Apply, pick }
}

export type RewindAppliers = {
  applyLive: (args: { cuts: readonly RewindCutWire[]; toSeq: number }) => Promise<void>
  applyOffline: (args: { threadId: string; toSeq: number; cutAgents: string[] }) => Promise<void>
  refreshEvents: () => void
}

export async function applyRewindPick(args: {
  threadId: string
  pick: RewindPick
  appliers: RewindAppliers
}): Promise<void> {
  const { pick, appliers } = args
  if (pick.route === ERewindRoute.Live) {
    await appliers.applyLive({ cuts: pick.cuts, toSeq: pick.toSeq })
    return
  }
  await appliers.applyOffline({
    threadId: args.threadId,
    toSeq: pick.toSeq,
    cutAgents: pick.cutAgents,
  })
  appliers.refreshEvents()
}
