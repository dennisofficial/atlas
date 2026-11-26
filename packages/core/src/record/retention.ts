import { EAgentStatus } from '../agents/status'
import type { EventType } from '../events/body'
import type { RecordBody, RecordEvent, RecordEventType } from './event'
import { groupStatesOf, isOpenGroupOf, keptGroupsOf, SUPERSEDED_BY } from './retention-groups'
import { ETurnOutcome } from './turns'

type CoreType = EventType | RecordBody['type']

export enum ERetention {
  All = 'all',
  Open = 'open',
  Latest = 'latest',
  None = 'none',
}

export { SUPERSEDED_BY }

export const EVENT_RETENTION = {
  'workspace-attempt-started': ERetention.All,
  'workspace-step': ERetention.All,
  'workspace-prepared': ERetention.All,
  'workspace-prepare-failed': ERetention.All,
  'sandbox-setup-reported': ERetention.All,
  'session-start-failed': ERetention.All,
  'session-archived': ERetention.All,
  'agent-spawned': ERetention.All,
  'agent-restarted': ERetention.All,
  'agent-ended': ERetention.All,
  'agent-reported': ERetention.All,
  'input-withdrawn': ERetention.All,
  'model-waiting': ERetention.All,
  'model-wait-cleared': ERetention.All,
  'history-rewound': ERetention.All,
  'run-failure-dismissed': ERetention.All,
  'turn-started': ERetention.Open,
  'turn-ended': ERetention.Open,
  'background-shell-started': ERetention.Open,
  'background-shell-ended': ERetention.Open,
  'service-started': ERetention.Open,
  'service-ended': ERetention.Open,
  'subscription-created': ERetention.Open,
  'subscription-changed': ERetention.Open,
  'subscription-ended': ERetention.Open,
  'tool-called': ERetention.Open,
  'tool-dispatched': ERetention.Open,
  'tool-parked': ERetention.Open,
  'tool-result': ERetention.Open,
  'tool-denied': ERetention.Open,
  'approval-requested': ERetention.Open,
  'approval-answered': ERetention.Open,
  'operator-input-requested': ERetention.Open,
  'operator-input-resolved': ERetention.Open,
  'run-failed': ERetention.Open,
  'input-refused': ERetention.Open,
  'worktree-entered': ERetention.Latest,
  'worktree-exited': ERetention.Latest,
  'directory-changed': ERetention.Latest,
  'location-changed': ERetention.Latest,
  'context-changed': ERetention.Latest,
  'background-shell-still-running': ERetention.None,
  'background-shell-awaiting-input': ERetention.None,
  'background-shell-matched': ERetention.None,
  'checkout-observed': ERetention.None,
  'branches-observed': ERetention.None,
  'resource-loaded': ERetention.None,
  'permission-granted': ERetention.None,
  'permission-revoked': ERetention.None,
  'pull-request-linked': ERetention.None,
  'retry-scheduled': ERetention.None,
  'user-said': ERetention.None,
  'assistant-said': ERetention.None,
  'classifier-judged': ERetention.None,
  'loop-watch-verdict': ERetention.None,
  'context-loaded': ERetention.None,
  'code-quality-reviewed': ERetention.None,
  'diagram-repaired': ERetention.None,
  'tldr-written': ERetention.None,
  'history-compacted': ERetention.None,
  'history-summarised': ERetention.None,
  'pod-ran-out-of-memory': ERetention.None,
  'pod-resize-started': ERetention.None,
  'pod-resized': ERetention.None,
  'pr-event': ERetention.None,
  'run-event': ERetention.None,
  'turn-failed': ERetention.None,
  'model-fell-back': ERetention.None,
  nudge: ERetention.None,
  parked: ERetention.None,
  rotated: ERetention.None,
  'resume-marked': ERetention.None,
  'command-applied': ERetention.None,
  'input-posted': ERetention.None,
  'input-consumed': ERetention.None,
  'idle-released': ERetention.None,
  'fact-recorded': ERetention.None,
} as const satisfies Record<CoreType, ERetention>

const isCoreType = (type: string): type is CoreType => Object.hasOwn(EVENT_RETENTION, type)

export const retentionOf = (type: string): ERetention =>
  isCoreType(type) ? EVENT_RETENTION[type] : ERetention.All

export const isRetained = (type: string): boolean => retentionOf(type) !== ERetention.None

export const RETAINED_TYPES: readonly RecordEventType[] = (
  Object.keys(EVENT_RETENTION) as RecordEventType[]
).filter(isRetained)

const dedupedOf = <TEvent extends { seq: number }>(events: readonly TEvent[]): TEvent[] => {
  const bySeq = new Map<number, TEvent>()
  for (const event of events) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}

const latestSeqsOf = (args: {
  events: readonly RecordEvent[]
  before: number
}): ReadonlySet<number> => {
  const kept = new Set<number>()
  const threads = new Set<string>()
  const paths = new Set<string>()
  for (let index = args.events.length - 1; index >= 0; index -= 1) {
    const event = args.events[index]
    if (event === undefined) continue
    if (retentionOf(event.type) !== ERetention.Latest) continue
    const visible = event.seq >= args.before
    if (event.type === 'context-changed') {
      const unseen = event.paths.filter((path) => !paths.has(path))
      for (const path of event.paths) paths.add(path)
      if (!visible && unseen.length > 0) kept.add(event.seq)
      continue
    }
    if (threads.has(event.threadId)) continue
    threads.add(event.threadId)
    if (!visible) kept.add(event.seq)
  }
  return kept
}

const keptOf = (args: {
  event: RecordEvent
  before: number
  open: ReadonlySet<string>
  latest: ReadonlySet<number>
}): boolean => {
  const retention = retentionOf(args.event.type)
  if (args.event.seq >= args.before) return retention !== ERetention.None
  if (retention === ERetention.All) return true
  if (retention === ERetention.None) return false
  if (retention === ERetention.Latest) return args.latest.has(args.event.seq)
  return isOpenGroupOf({ event: args.event, open: args.open })
}

const isFailureBearing = (event: RecordEvent): boolean =>
  event.type === 'run-failed' ||
  (event.type === 'agent-ended' &&
    event.status === EAgentStatus.Failed &&
    event.failure !== undefined)

const supersederSeqsOf = <TEvent extends RecordEvent>(args: {
  events: readonly TEvent[]
  before: number
  kept: (event: TEvent) => boolean
}): ReadonlySet<number> => {
  const kept = new Set<number>()
  const pending = new Set<string>()
  for (const event of args.events) {
    if (isFailureBearing(event) && args.kept(event)) {
      for (const type of SUPERSEDED_BY['run-failed']) pending.add(type)
      continue
    }
    if (event.seq >= args.before || !pending.has(event.type)) continue
    kept.add(event.seq)
    pending.delete(event.type)
  }
  return kept
}

type TurnEndedEvent = Extract<RecordEvent, { type: 'turn-ended' }>

const RESUMABLE_OUTCOMES: ReadonlySet<ETurnOutcome> = new Set([
  ETurnOutcome.Stopped,
  ETurnOutcome.Interrupted,
])

const resumableTurnSeqsOf = (args: {
  events: readonly RecordEvent[]
  before: number
}): ReadonlySet<number> => {
  const kept = new Set<number>()
  const ending = args.events.findLast(
    (event): event is TurnEndedEvent => event.type === 'turn-ended' && event.seq < args.before,
  )
  if (ending === undefined || !RESUMABLE_OUTCOMES.has(ending.outcome)) return kept
  const start = args.events.findLast(
    (event) => event.type === 'turn-started' && event.seq < ending.seq,
  )
  const from = start?.seq ?? 0
  for (const event of args.events) {
    if (event.seq >= from && event.seq < args.before) kept.add(event.seq)
  }
  return kept
}

export const retainedOf = <TEvent extends RecordEvent>(args: {
  events: readonly TEvent[]
  before: number
}): TEvent[] => {
  const events = dedupedOf(args.events)
  const groups = groupStatesOf(events)
  const open = keptGroupsOf(groups)
  const latest = latestSeqsOf({ events, before: args.before })
  const kept = (event: TEvent): boolean => keptOf({ event, before: args.before, open, latest })
  const extra = new Set<number>([
    ...supersederSeqsOf({ events, before: args.before, kept }),
    ...resumableTurnSeqsOf({ events, before: args.before }),
  ])
  return events.filter((event) => kept(event) || extra.has(event.seq))
}
