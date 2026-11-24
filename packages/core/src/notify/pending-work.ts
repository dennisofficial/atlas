import { agentLifecycleKind } from '../agents/roster'
import type { Event, EventOfType } from '../events/envelope'
import { ELifecycleState, lifecycleOf, type LifecycleKind } from '../lifecycle/lifecycle'
import { shellKey, shellLifecycleKind } from '../shells/lifecycle'
import { ESubscriptionStatus, subscriptionsOf } from '../subscriptions/subscription'

export enum EPendingWork {
  Shell = 'shell',
  Agent = 'agent',
  Subscription = 'subscription',
}

export type OpenWork = { key: string; since: string }

export type PendingWork = OpenWork & { kind: EPendingWork }

export type PendingWorkSource = {
  kind: EPendingWork
  holdMs: number
  wakeTypes: readonly string[]
  openOf: (events: readonly Event[]) => readonly OpenWork[]
}

const MINUTE_MS = 60_000

type StartedAgent = EventOfType<'agent-spawned'> | EventOfType<'agent-restarted'>
type EndedAgent = EventOfType<'agent-ended'>

const agentPendingKind: LifecycleKind<StartedAgent, EndedAgent> = {
  ...agentLifecycleKind,
  isStart: (event): event is StartedAgent =>
    event.type === 'agent-spawned' || event.type === 'agent-restarted',
}

const openLifecyclesOf = <TStart extends Event, TEnd extends Event>(args: {
  events: readonly Event[]
  kind: LifecycleKind<TStart, TEnd>
  keyOf: (started: TStart) => string
}): readonly OpenWork[] =>
  lifecycleOf(args.events, args.kind)
    .filter((lifecycle) => lifecycle.state !== ELifecycleState.Settled)
    .map((lifecycle) => ({ key: args.keyOf(lifecycle.started), since: lifecycle.started.at }))

const openSubscriptionsOf = (events: readonly Event[]): readonly OpenWork[] =>
  subscriptionsOf(events)
    .filter((subscription) => subscription.status === ESubscriptionStatus.Active)
    .map((subscription) => ({ key: subscription.id, since: subscription.createdAt }))

export const PENDING_WORK_SOURCES: readonly PendingWorkSource[] = [
  {
    kind: EPendingWork.Shell,
    holdMs: 60 * MINUTE_MS,
    wakeTypes: ['background-shell-ended'],
    openOf: (events) =>
      openLifecyclesOf({ events, kind: shellLifecycleKind, keyOf: (started) => shellKey(started) }),
  },
  {
    kind: EPendingWork.Agent,
    holdMs: 60 * MINUTE_MS,
    wakeTypes: ['agent-ended', 'agent-reported'],
    openOf: (events) =>
      openLifecyclesOf({ events, kind: agentPendingKind, keyOf: (started) => started.agentId }),
  },
  {
    kind: EPendingWork.Subscription,
    holdMs: 10 * MINUTE_MS,
    wakeTypes: ['subscription-ended', 'pr-event', 'run-event'],
    openOf: openSubscriptionsOf,
  },
]

export const pendingWorkOf = (args: { events: readonly Event[] }): readonly PendingWork[] => {
  const pending: PendingWork[] = []
  for (const source of PENDING_WORK_SOURCES) {
    for (const open of source.openOf(args.events)) {
      const known = pending.some((work) => work.kind === source.kind && work.key === open.key)
      if (!known) pending.push({ kind: source.kind, ...open })
    }
  }
  return pending
}

export const holdMsOf = (kinds: readonly EPendingWork[]): number =>
  PENDING_WORK_SOURCES.filter((source) => kinds.includes(source.kind)).reduce(
    (held, source) => Math.max(held, source.holdMs),
    0,
  )
