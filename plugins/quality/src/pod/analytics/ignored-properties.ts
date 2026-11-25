import {
  EQualityFindingState,
  type CodeQualityReviewedBody,
  type ThreadId,
  type RecordEvent,
} from '@dltech/atlas-core'

import { foldQualityFindings } from '../../review/ledger'
import type { QualityReviewEventProperties } from './review-properties'
import {
  lastTurnStartOf,
  notifyIndexOf,
  qualityRecordsOf,
  stepsAfter,
  threadEventsOf,
  turnsAfter,
} from './timeline'

const activeFindingsOf = (args: {
  records: readonly CodeQualityReviewedBody[]
}): ReadonlyMap<string, { policyId: string; state: EQualityFindingState }> => {
  const held = new Map<string, { policyId: string; state: EQualityFindingState }>()
  for (const findings of foldQualityFindings({ records: args.records }).values()) {
    for (const finding of findings) {
      held.set(finding.id, { policyId: finding.policyId, state: finding.state })
    }
  }
  return held
}

export const ignoredFindingProperties = (args: {
  events: readonly RecordEvent[]
  threadId: ThreadId
}): readonly QualityReviewEventProperties[] => {
  const thread = threadEventsOf({ events: args.events, threadId: args.threadId })
  const turnStartedAt = lastTurnStartOf({ events: thread })
  if (turnStartedAt === -1) return []

  const records = qualityRecordsOf({ events: thread })
  const ledger = activeFindingsOf({ records: records.map(({ record }) => record) })
  const notifiedThisTurn = records
    .filter(({ index }) => index > turnStartedAt)
    .flatMap(({ record }) => record.findings.filter((finding) => finding.notified))

  const properties: QualityReviewEventProperties[] = []
  const seen = new Set<string>()
  for (const finding of notifiedThisTurn) {
    if (seen.has(finding.id)) continue
    seen.add(finding.id)
    const held = ledger.get(finding.id)
    if (held === undefined || held.state !== EQualityFindingState.Active) continue
    const index = notifyIndexOf({ events: thread, findingId: finding.id })
    if (index === null || index <= turnStartedAt) continue
    properties.push({
      policy_id: finding.policyId,
      steps_after_nudge: stepsAfter({ events: thread, index }),
      turns_after_nudge: turnsAfter({ events: thread, index }),
    })
  }
  return properties
}
