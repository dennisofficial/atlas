import {
  EQualityFindingState,
  type CodeQualityReviewedBody,
  type QualityAssessment,
  type QualityFinding,
  type RecordEvent,
  type ThreadId,
} from '@dltech/atlas-core'

import { qualityRegistry } from '../../review/registry'
import type { QualityReviewEventProperties } from './review-properties'
import {
  lastTurnStartOf,
  notifyIndexOf,
  qualityRecordsOf,
  stepsAfter,
  threadEventsOf,
  turnsAfter,
  type QualityRecordEntry,
} from './timeline'

export const QUALITY_NUDGE_REACTION = 'quality nudge reaction'

export enum ENudgeReaction {
  Fixed = 'fixed',
  EditedStillFlagged = 'edited_still_flagged',
  Untouched = 'untouched',
}

const assessmentOf = (args: {
  record: CodeQualityReviewedBody
  finding: QualityFinding
}): QualityAssessment | undefined =>
  args.record.assessments.find(
    (assessment) =>
      assessment.policyId === args.finding.policyId && assessment.scopeId === args.finding.scopeId,
  )

const laterScopeRecordsOf = (args: {
  records: readonly QualityRecordEntry[]
  index: number
  scopeId: string
}): readonly QualityRecordEntry[] =>
  args.records.filter(
    ({ record, index }) => index > args.index && record.scope?.id === args.scopeId,
  )

const reactionOf = (args: {
  later: readonly QualityRecordEntry[]
  finding: QualityFinding
}): ENudgeReaction => {
  const fixed = args.later.some(({ record }) =>
    record.findings.some(
      (finding) =>
        finding.id === args.finding.id && finding.state === EQualityFindingState.Resolved,
    ),
  )
  if (fixed) return ENudgeReaction.Fixed
  const assessed = args.later.some(
    ({ record }) => assessmentOf({ record, finding: args.finding }) !== undefined,
  )
  return assessed ? ENudgeReaction.EditedStillFlagged : ENudgeReaction.Untouched
}

const concernAtEndOf = (args: {
  atNudge: CodeQualityReviewedBody
  later: readonly QualityRecordEntry[]
  finding: QualityFinding
}): number | null => {
  const last = [...args.later]
    .reverse()
    .find(({ record }) => assessmentOf({ record, finding: args.finding }) !== undefined)
  const record = last?.record ?? args.atNudge
  return assessmentOf({ record, finding: args.finding })?.currentConcernProbability ?? null
}

const mentionTermsOf = (args: {
  atNudge: CodeQualityReviewedBody
  policyId: string
}): readonly string[] => {
  const title = qualityRegistry.get({ id: args.policyId })?.title ?? args.policyId
  return [args.atNudge.scope?.name ?? '', title].flatMap((term) =>
    term === '' ? [] : [term.toLowerCase()],
  )
}

const replyTextOf = (event: RecordEvent): string => {
  if (event.type !== 'assistant-said') return ''
  return event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
}

const mentionedInReply = (args: {
  events: readonly RecordEvent[]
  index: number
  terms: readonly string[]
}): boolean => {
  const text = args.events
    .flatMap((event, index) => (index > args.index ? [replyTextOf(event)] : []))
    .join('\n')
    .toLowerCase()
  return args.terms.some((term) => text.includes(term))
}

export const nudgeReactionProperties = (args: {
  events: readonly RecordEvent[]
  threadId: ThreadId
  reviewIds: ReadonlyMap<string, string>
}): readonly QualityReviewEventProperties[] => {
  const thread = threadEventsOf({ events: args.events, threadId: args.threadId })
  const turnStartedAt = lastTurnStartOf({ events: thread })
  if (turnStartedAt === -1) return []

  const records = qualityRecordsOf({ events: thread })
  const properties: QualityReviewEventProperties[] = []
  const seen = new Set<string>()
  for (const { record } of records) {
    for (const finding of record.findings) {
      if (!finding.notified || seen.has(finding.id)) continue
      seen.add(finding.id)
      const index = notifyIndexOf({ events: thread, findingId: finding.id })
      if (index === null || index <= turnStartedAt) continue
      const atNudge = records.find((entry) => entry.index === index)?.record
      if (atNudge === undefined) continue
      const later = laterScopeRecordsOf({ records, index, scopeId: finding.scopeId })
      properties.push({
        review_id: args.reviewIds.get(finding.id) ?? null,
        finding_id: finding.id,
        episode: finding.episode,
        policy_id: finding.policyId,
        reaction: reactionOf({ later, finding }),
        mentioned_in_reply: mentionedInReply({
          events: thread,
          index,
          terms: mentionTermsOf({ atNudge, policyId: finding.policyId }),
        }),
        concern_at_nudge:
          assessmentOf({ record: atNudge, finding })?.currentConcernProbability ?? null,
        concern_at_end: concernAtEndOf({ atNudge, later, finding }),
        steps_after_nudge: stepsAfter({ events: thread, index }),
        turns_after_nudge: turnsAfter({ events: thread, index }),
      })
    }
  }
  return properties
}
