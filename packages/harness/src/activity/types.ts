import type { RosterWire, SandboxActivityPost } from '@dltech/atlas-wire'

import type { TurnOutcome } from '../loop/turn-outcome'

export type ActivityReport = Pick<SandboxActivityPost, 'working' | 'awaiting' | 'lastOutcome'>
export type ActivityOutcome = NonNullable<ActivityReport['lastOutcome']>

export type ActivityTracker = {
  turnStarted(): void
  turnOutcome(outcome: TurnOutcome): void
  turnFailed(): void
  turnEnded(): void
  setInput(waiting: boolean): void
  setApproval(waiting: boolean): void
  setBackground(running: boolean): void
}

export type ActivityRoster = {
  snapshot(): Pick<RosterWire, 'agents' | 'shells'>
  subscribe(listener: () => void): () => void
}

export type ActivityBinding = { tracker: ActivityTracker; detach(): void }
