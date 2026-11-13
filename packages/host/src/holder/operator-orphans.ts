import {
  EOperatorRequestOutcome,
  OPERATOR_INPUT_SETTLED,
  type OperatorInputSettled,
} from '@dltech/atlas-plugin-operator/core'
import {
  openParkedCall,
  type Event,
  type RunId,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'

import type { OperatorRequestPort } from './operator-requests'
import type { SessionRecord } from './record/record-adapter'

export type Asked = Extract<V2Event, { type: 'operator-input-asked' }>

export type OperatorOrphanArgs = {
  requests: OperatorRequestPort
  sessionId: string
  threadId: ThreadId
  record: SessionRecord
  newRunId: () => RunId
}

const ORPHANED_REASON = 'its parked call closed without the operator answering'

export const openRequestsOf = (events: readonly V2Event[]): ReadonlyMap<string, Asked> => {
  const open = new Map<string, Asked>()
  for (const event of events) {
    if (event.type === 'operator-input-asked') open.set(event.requestId, event)
    if (event.type === 'operator-input-settled') open.delete(event.requestId)
  }
  return open
}

export const settledOf = (args: {
  requestId: string
  sessionId: string
  outcome: EOperatorRequestOutcome
  path?: string | undefined
  bytes?: number | undefined
  reason?: string | undefined
}): OperatorInputSettled => ({
  type: OPERATOR_INPUT_SETTLED,
  requestId: args.requestId,
  outcome: args.outcome,
  ...(args.path === undefined ? {} : { path: args.path }),
  ...(args.bytes === undefined ? {} : { bytes: args.bytes }),
  ...(args.reason === undefined ? {} : { reason: args.reason }),
  sessionId: args.sessionId,
})

export const orphanedOf = (events: readonly V2Event[]): readonly Asked[] => {
  const open = [...openRequestsOf(events).values()]
  if (open.length === 0) return []
  return openParkedCall(events as readonly Event[]) === undefined ? open : []
}

export const settleOperatorOrphans = async (args: OperatorOrphanArgs): Promise<void> => {
  const orphans = orphanedOf(args.record.eventCache().eventsAfter(0))
  if (orphans.length === 0) return
  await args.record.append({
    threadId: args.threadId,
    runId: args.newRunId(),
    drafts: orphans.map((asked) =>
      settledOf({
        requestId: asked.requestId,
        sessionId: args.sessionId,
        outcome: EOperatorRequestOutcome.Abandoned,
        reason: ORPHANED_REASON,
      }),
    ),
  })
  for (const asked of orphans) {
    await args.requests
      .settle({ requestId: asked.requestId, outcome: EOperatorRequestOutcome.Abandoned })
      .catch(() => false)
  }
}
