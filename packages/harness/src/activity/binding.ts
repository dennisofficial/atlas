import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import { EAgentStatus, EShellStatus, type RosterWire } from '@dltech/atlas-wire'

import type { DeltaChannel } from '../channel/delta-channel'
import { createApprovalWatcher } from './approval'
import { createActivityTracker } from './state'
import type { ActivityBinding, ActivityReport, ActivityRoster } from './types'

export function bindThreadActivity(args: {
  threadId: ThreadId
  log: Pick<EventLogPort, 'head' | 'readOwn'>
  channel: Pick<DeltaChannel, 'subscribe'>
  roster?: ActivityRoster | undefined
  report: (state: ActivityReport) => void
}): ActivityBinding {
  const tracker = createActivityTracker({ report: args.report })
  const approvals = createApprovalWatcher({
    threadId: args.threadId,
    log: args.log,
    onChange: tracker.setApproval,
    onWaiting: tracker.setWaiting,
  })
  const unsubscribe = args.channel.subscribe({
    threadId: args.threadId,
    listener: (signal) => {
      if (signal.type === 'operator-input') tracker.setInput(signal.request !== null)
      if (signal.type === 'events-appended' || signal.type === 'step-ended') approvals.refresh()
    },
  })
  approvals.refresh()
  const roster = args.roster
  const refreshBackground = (): void => {
    if (roster !== undefined) tracker.setBackground(backgroundRunning(roster.snapshot()))
  }
  const unsubscribeRoster = roster?.subscribe(refreshBackground)
  refreshBackground()
  return {
    tracker,
    detach: () => {
      unsubscribe()
      unsubscribeRoster?.()
    },
  }
}

export const backgroundRunning = (roster: Pick<RosterWire, 'agents' | 'shells'>): boolean =>
  roster.agents.some((agent) => agent.status === EAgentStatus.Running) ||
  roster.shells.some((shell) => shell.status === EShellStatus.Running)
