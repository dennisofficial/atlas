import type { WaitingForModel } from '@dltech/atlas-core'
import type { RosterWire, SandboxActivityPost } from '@dltech/atlas-wire'

import type { TurnOutcome } from '../loop/turn-outcome'

export type ActivityReport = Pick<SandboxActivityPost, 'working' | 'awaiting' | 'lastOutcome'> & {
  waitingForModel?: WaitingForModel
}
export type ActivityOutcome = NonNullable<ActivityReport['lastOutcome']>

export type ActivityTracker = {
  turnStarted(): void
  turnOutcome(outcome: TurnOutcome): void
  turnFailed(): void
  turnEnded(): void
  setInput(waiting: boolean): void
  setApproval(waiting: boolean): void
  setBackground(running: boolean): void
  setWaiting(waiting: WaitingForModel | null): void
}

export type ActivityRoster = {
  snapshot(): Pick<RosterWire, 'agents' | 'shells'>
  subscribe(listener: () => void): () => void
}

export type ActivityBinding = { tracker: ActivityTracker; detach(): void }
