import {
  EQualityFindingState,
  EQualityTransition,
  type CodeQualityReviewedBody,
  type QualityFinding,
  type RecordEvent,
  type ThreadId,
} from '@dltech/atlas-core'

import { foldQualityFindings } from '../../review/ledger'
import type { QualityReviewEventProperties } from './review-properties'
import { notifyIndexOf, qualityRecordsOf, stepsAfter, threadEventsOf, turnsAfter } from './timeline'

const activeIdsOf = (args: { events: readonly RecordEvent[] }): ReadonlySet<string> => {
  const records = qualityRecordsOf(args).map(({ record }) => record)
  return new Set(
    [...foldQualityFindings({ records }).values()]
      .flat()
      .filter((finding) => finding.state === EQualityFindingState.Active)
      .map((finding) => finding.id),
  )
}

const classifierResolved = (args: {
  record: CodeQualityReviewedBody
  finding: QualityFinding
}): boolean =>
  args.record.assessments.some(
    (assessment) =>
      assessment.policyId === args.finding.policyId &&
      assessment.scopeId === args.finding.scopeId &&
      assessment.transition === EQualityTransition.Resolve,
  )

export const closedFindingProperties = (args: {
  records: readonly CodeQualityReviewedBody[]
  events: readonly RecordEvent[]
  threadId: ThreadId
}): readonly QualityReviewEventProperties[] => {
  const thread = threadEventsOf({ events: args.events, threadId: args.threadId })
  const activeBefore = activeIdsOf({ events: thread })
  const properties: QualityReviewEventProperties[] = []
  for (const record of args.records) {
    for (const finding of record.findings) {
      if (finding.state !== EQualityFindingState.Resolved) continue
      if (!finding.notified || !activeBefore.has(finding.id)) continue
      if (classifierResolved({ record, finding })) continue
      const index = notifyIndexOf({ events: thread, findingId: finding.id })
      if (index === null) continue
      properties.push({
        policy_id: finding.policyId,
        steps_after_nudge: stepsAfter({ events: thread, index }),
        turns_after_nudge: turnsAfter({ events: thread, index }),
      })
    }
  }
  return properties
}
