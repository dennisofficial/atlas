import {
  CORE_EVENT_TYPES,
  EQualityFindingState,
  EQualityReviewStatus,
  currentContextEvents,
  type CodeQualityReviewedBody,
  type Event,
  type EventDraft,
  type RecordEvent,
} from '@dltech/atlas-core'

import type { QualityNote } from '../review/review-records'

export const QUALITY_REVIEW_SLOT = 'quality-review'

export const noteDraftsOf = ({ notes }: { notes: readonly QualityNote[] }): readonly EventDraft[] =>
  notes.map((note) => ({
    type: 'context-loaded',
    slot: QUALITY_REVIEW_SLOT,
    key: note.key,
    content: note.content,
  }))

type CoreEvent = Extract<RecordEvent, Event>

const isCoreEvent = (event: RecordEvent): event is CoreEvent => CORE_EVENT_TYPES.has(event.type)

const currentNoteKeys = ({ events }: { events: readonly RecordEvent[] }): ReadonlySet<string> =>
  new Set(
    currentContextEvents(events.filter(isCoreEvent))
      .filter((event) => event.slot === QUALITY_REVIEW_SLOT && event.content.trim() !== '')
      .map((event) => event.key),
  )

const stillConcerned = (record: CodeQualityReviewedBody): boolean =>
  record.findings.some((finding) => finding.state === EQualityFindingState.Active)

const reviewedClean = (args: {
  records: readonly CodeQualityReviewedBody[]
}): ReadonlySet<string> =>
  new Set(
    args.records
      .filter((record) => record.status === EQualityReviewStatus.Completed)
      .map((record) => record.path)
      .filter(
        (path) => !args.records.some((record) => record.path === path && stillConcerned(record)),
      ),
  )

export const retirementDraftsOf = (args: {
  events: readonly RecordEvent[]
  records: readonly CodeQualityReviewedBody[]
  notes: readonly QualityNote[]
}): readonly EventDraft[] => {
  const noted = new Set(args.notes.map((note) => note.key))
  const live = currentNoteKeys({ events: args.events })
  return [...reviewedClean({ records: args.records })]
    .filter((path) => !noted.has(path) && live.has(path))
    .map((path) => ({ type: 'context-loaded', slot: QUALITY_REVIEW_SLOT, key: path, content: '' }))
}
