import type { EventType } from '../events/body'
import type { RecordBody, V2EventType } from './event'

type CoreType = EventType | RecordBody['type']

export const EVENT_DURABILITY = {
  'workspace-attempt-started': true,
  'workspace-step': true,
  'workspace-prepared': true,
  'sandbox-setup-reported': true,
  'turn-started': true,
  'turn-ended': true,
  'model-waiting': true,
  'model-wait-cleared': true,
  'background-shell-started': true,
  'background-shell-ended': true,
  'agent-spawned': true,
  'agent-restarted': true,
  'agent-ended': true,
  'service-started': true,
  'service-ended': true,
  'subscription-created': true,
  'subscription-changed': true,
  'subscription-ended': true,
  'session-archived': true,
  'workspace-prepare-failed': true,
  'background-shell-still-running': false,
  'background-shell-matched': false,
  'worktree-entered': false,
  'worktree-exited': false,
  'directory-changed': false,
  'location-changed': false,
  'checkout-observed': false,
  'branches-observed': false,
  'resource-loaded': false,
  'context-changed': false,
  'permission-granted': false,
  'permission-revoked': false,
  'pull-request-linked': false,
  'background-shell-awaiting-input': false,
  'retry-scheduled': false,
  'session-start-failed': false,
  'user-said': false,
  'assistant-said': false,
  'tool-called': false,
  'tool-dispatched': false,
  'tool-parked': false,
  'tool-result': false,
  'tool-denied': false,
  'approval-requested': false,
  'approval-answered': false,
  'operator-input-requested': false,
  'operator-input-resolved': false,
  'classifier-judged': false,
  'loop-watch-verdict': false,
  'context-loaded': false,
  'code-quality-reviewed': false,
  'diagram-repaired': false,
  'tldr-written': false,
  'history-compacted': false,
  'history-rewound': false,
  'history-summarised': false,
  'agent-reported': false,
  'pod-ran-out-of-memory': false,
  'pr-event': false,
  'run-event': false,
  'run-failed': false,
  'run-failure-dismissed': false,
  'turn-failed': false,
  'model-fell-back': false,
  nudge: false,
  parked: false,
  rotated: false,
  'resume-marked': false,
  'input-posted': false,
  'input-consumed': false,
  'input-withdrawn': false,
  'input-refused': false,
  'idle-released': false,
  'fact-recorded': false,
} as const satisfies Record<CoreType, boolean>

const isCoreType = (type: string): type is CoreType => Object.hasOwn(EVENT_DURABILITY, type)

export const isDurable = (type: string): boolean =>
  isCoreType(type) ? EVENT_DURABILITY[type] : true

export const DURABLE_TYPES: readonly V2EventType[] = (
  Object.keys(EVENT_DURABILITY) as V2EventType[]
).filter(isDurable)

export const foldableOf = <TEvent extends { seq: number }>(args: {
  visible: readonly TEvent[]
  durable: readonly TEvent[]
}): TEvent[] => {
  const bySeq = new Map<number, TEvent>()
  for (const event of args.durable) bySeq.set(event.seq, event)
  for (const event of args.visible) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}
