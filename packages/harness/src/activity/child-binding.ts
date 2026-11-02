import { toRunId, type ThreadId } from '@dltech/atlas-core'

import type { DeltaChannel } from '../channel/delta-channel'
import { EStepEnd } from '../channel/signal'
import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'
import { backgroundRunning } from './binding'
import { createActivityTracker } from './state'
import type { ActivityReport, ActivityRoster } from './types'

const CHILD_RUN = toRunId('child-turn')

const turnOutcomeOfStepEnd = (end: EStepEnd): TurnOutcome | undefined => {
  switch (end) {
    case EStepEnd.Completed:
      return { status: ETurnStatus.Completed, runId: CHILD_RUN }
    case EStepEnd.Interrupted:
      return { status: ETurnStatus.Interrupted, runId: CHILD_RUN, committed: false }
    case EStepEnd.Failed:
    case EStepEnd.Retried:
    case EStepEnd.Detached:
      return undefined
  }
}

export function bindChildThreadActivity(args: {
  threadId: ThreadId
  channel: Pick<DeltaChannel, 'subscribe'>
  roster?: ActivityRoster | undefined
  report: (state: ActivityReport) => void
}): { detach: () => void } {
  const tracker = createActivityTracker({ report: args.report })
  const detach = args.channel.subscribe({
    threadId: args.threadId,
    listener: (signal) => {
      if (signal.type === 'operator-input') tracker.setInput(signal.request !== null)
      if (signal.type === 'step-ended') {
        if (signal.end === EStepEnd.Failed) tracker.turnFailed()
        const outcome = turnOutcomeOfStepEnd(signal.end)
        if (outcome !== undefined) tracker.turnOutcome(outcome)
      }
      if (signal.type !== 'turn-working') return
      if (signal.working) tracker.turnStarted()
      else tracker.turnEnded()
    },
  })
  const roster = args.roster
  const refreshBackground = (): void => {
    if (roster !== undefined)
      tracker.setBackground(
        backgroundRunning({ threadId: args.threadId, roster: roster.snapshot() }),
      )
  }
  const unsubscribeRoster = roster?.subscribe(refreshBackground)
  refreshBackground()
  return {
    detach: () => {
      detach()
      unsubscribeRoster?.()
    },
  }
}
