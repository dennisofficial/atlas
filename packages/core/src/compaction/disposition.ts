import type { EventType } from '../events/body'

export enum ECompactionDisposition {
  Keep = 'keep',
  Summarise = 'summarise',
  Drop = 'drop',
}

export const COMPACTION_DISPOSITION = {
  'context-loaded': ECompactionDisposition.Keep,
  'code-quality-reviewed': ECompactionDisposition.Keep,
  'permission-granted': ECompactionDisposition.Keep,
  'permission-revoked': ECompactionDisposition.Keep,
  'pull-request-linked': ECompactionDisposition.Keep,
  'location-changed': ECompactionDisposition.Keep,
  'checkout-observed': ECompactionDisposition.Keep,
  'subscription-created': ECompactionDisposition.Keep,
  'subscription-changed': ECompactionDisposition.Keep,
  'subscription-ended': ECompactionDisposition.Keep,
  'model-waiting': ECompactionDisposition.Keep,
  'model-wait-cleared': ECompactionDisposition.Keep,
  'worktree-entered': ECompactionDisposition.Keep,
  'worktree-exited': ECompactionDisposition.Keep,
  'directory-changed': ECompactionDisposition.Keep,
  'user-said': ECompactionDisposition.Summarise,
  'assistant-said': ECompactionDisposition.Summarise,
  'tool-called': ECompactionDisposition.Summarise,
  'tool-result': ECompactionDisposition.Summarise,
  'tool-denied': ECompactionDisposition.Summarise,
  'history-compacted': ECompactionDisposition.Summarise,
  'agent-ended': ECompactionDisposition.Summarise,
  'agent-reported': ECompactionDisposition.Summarise,
  'agent-restarted': ECompactionDisposition.Summarise,
  'background-shell-ended': ECompactionDisposition.Summarise,
  'background-shell-still-running': ECompactionDisposition.Summarise,
  'background-shell-matched': ECompactionDisposition.Summarise,
  'background-shell-awaiting-input': ECompactionDisposition.Summarise,
  'service-ended': ECompactionDisposition.Summarise,
  'pr-event': ECompactionDisposition.Summarise,
  nudge: ECompactionDisposition.Summarise,
  'sandbox-setup-reported': ECompactionDisposition.Summarise,
  parked: ECompactionDisposition.Summarise,
  'tool-dispatched': ECompactionDisposition.Drop,
  'approval-requested': ECompactionDisposition.Drop,
  'approval-answered': ECompactionDisposition.Drop,
  'operator-input-requested': ECompactionDisposition.Drop,
  'operator-input-resolved': ECompactionDisposition.Drop,
  'classifier-judged': ECompactionDisposition.Drop,
  'loop-watch-verdict': ECompactionDisposition.Drop,
  'tldr-written': ECompactionDisposition.Drop,
  'diagram-repaired': ECompactionDisposition.Keep,
  'turn-failed': ECompactionDisposition.Drop,
  'run-failed': ECompactionDisposition.Drop,
  'run-failure-dismissed': ECompactionDisposition.Drop,
  rotated: ECompactionDisposition.Drop,
  'agent-spawned': ECompactionDisposition.Drop,
  'service-started': ECompactionDisposition.Drop,
  'background-shell-started': ECompactionDisposition.Drop,
} as const satisfies Record<EventType, ECompactionDisposition>

export type KeptType = {
  [TType in EventType]: (typeof COMPACTION_DISPOSITION)[TType] extends ECompactionDisposition.Keep
    ? TType
    : never
}[EventType]

export type SummarisedType = {
  [TType in EventType]: (typeof COMPACTION_DISPOSITION)[TType] extends ECompactionDisposition.Summarise
    ? TType
    : never
}[EventType]

export const compactionDisposition = (type: EventType): ECompactionDisposition =>
  COMPACTION_DISPOSITION[type]

export const KEPT_THROUGH_COMPACTION: readonly KeptType[] = (
  Object.keys(COMPACTION_DISPOSITION) as KeptType[]
).filter((type) => COMPACTION_DISPOSITION[type] === ECompactionDisposition.Keep)

export const keptThroughCompaction = (type: EventType): boolean =>
  COMPACTION_DISPOSITION[type] === ECompactionDisposition.Keep
