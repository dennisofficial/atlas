import type { EventType } from './body'
import type { Event, EventOfType } from './envelope'

export enum ERewindDisposition {
  Discard = 'discard',
  Keep = 'keep',
  KeepUnlessCreatorCut = 'keep-unless-creator-cut',
}

export const REWIND_DISPOSITION = {
  'user-said': ERewindDisposition.Discard,
  'assistant-said': ERewindDisposition.Discard,
  'tool-called': ERewindDisposition.Discard,
  'tool-dispatched': ERewindDisposition.Discard,
  'tool-result': ERewindDisposition.Discard,
  'tool-denied': ERewindDisposition.Discard,
  'approval-requested': ERewindDisposition.Discard,
  'approval-answered': ERewindDisposition.Discard,
  'operator-input-requested': ERewindDisposition.Discard,
  'operator-input-resolved': ERewindDisposition.Discard,
  'classifier-judged': ERewindDisposition.Discard,
  'context-loaded': ERewindDisposition.Discard,
  'code-quality-reviewed': ERewindDisposition.Discard,
  'directory-changed': ERewindDisposition.Discard,
  'history-compacted': ERewindDisposition.Discard,
  'loop-watch-verdict': ERewindDisposition.Discard,
  nudge: ERewindDisposition.Discard,
  'sandbox-setup-reported': ERewindDisposition.Discard,
  'turn-failed': ERewindDisposition.Discard,
  parked: ERewindDisposition.Discard,
  rotated: ERewindDisposition.Discard,
  'permission-granted': ERewindDisposition.Discard,
  'permission-revoked': ERewindDisposition.Discard,
  'pull-request-linked': ERewindDisposition.Discard,
  'tldr-written': ERewindDisposition.Discard,
  'subscription-created': ERewindDisposition.Discard,
  'subscription-changed': ERewindDisposition.Discard,
  'subscription-ended': ERewindDisposition.Discard,
  'run-failed': ERewindDisposition.Discard,
  'run-failure-dismissed': ERewindDisposition.Discard,
  'worktree-entered': ERewindDisposition.Discard,
  'worktree-exited': ERewindDisposition.Discard,
  'agent-spawned': ERewindDisposition.Discard,
  'agent-restarted': ERewindDisposition.Discard,
  'agent-reported': ERewindDisposition.Discard,
  'service-started': ERewindDisposition.Discard,
  'background-shell-started': ERewindDisposition.Discard,
  'location-changed': ERewindDisposition.Keep,
  'pr-event': ERewindDisposition.Keep,
  'agent-ended': ERewindDisposition.KeepUnlessCreatorCut,
  'service-ended': ERewindDisposition.KeepUnlessCreatorCut,
  'background-shell-ended': ERewindDisposition.KeepUnlessCreatorCut,
  'background-shell-awaiting-input': ERewindDisposition.KeepUnlessCreatorCut,
  'background-shell-matched': ERewindDisposition.KeepUnlessCreatorCut,
  'background-shell-still-running': ERewindDisposition.KeepUnlessCreatorCut,
} as const satisfies Record<EventType, ERewindDisposition>

export type CreatorBoundType = {
  [TType in EventType]: (typeof REWIND_DISPOSITION)[TType] extends ERewindDisposition.KeepUnlessCreatorCut
    ? TType
    : never
}[EventType]

export type CreatorBoundEvent = EventOfType<CreatorBoundType>

export const rewindDisposition = (type: EventType): ERewindDisposition => REWIND_DISPOSITION[type]

export const isCreatorBound = (event: Event): event is CreatorBoundEvent =>
  rewindDisposition(event.type) === ERewindDisposition.KeepUnlessCreatorCut
