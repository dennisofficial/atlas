import type { CodeQualityReviewedBody, ThreadId, RecordEvent } from '@dltech/atlas-core'

export type QualityRecordEntry = { record: CodeQualityReviewedBody; index: number }

const recordsInEvent = (event: RecordEvent): readonly CodeQualityReviewedBody[] => {
  if (event.type === 'code-quality-reviewed') return [event]
  if (event.type === 'tool-result') return event.qualityReviews ?? []
  return []
}

export const threadEventsOf = (args: {
  events: readonly RecordEvent[]
  threadId: ThreadId
}): readonly RecordEvent[] => args.events.filter((event) => event.threadId === args.threadId)

export const qualityRecordsOf = (args: {
  events: readonly RecordEvent[]
}): readonly QualityRecordEntry[] =>
  args.events.flatMap((event, index) => recordsInEvent(event).map((record) => ({ record, index })))

export const notifyIndexOf = (args: {
  events: readonly RecordEvent[]
  findingId: string
}): number | null => {
  for (const { record, index } of qualityRecordsOf({ events: args.events })) {
    if (record.findings.some((finding) => finding.id === args.findingId && finding.notified))
      return index
  }
  return null
}

export const countAfter = (args: {
  events: readonly RecordEvent[]
  index: number
  types: readonly RecordEvent['type'][]
}): number =>
  args.events.filter((event, index) => index > args.index && args.types.includes(event.type)).length

export const lastIndexOfType = (args: {
  events: readonly RecordEvent[]
  type: RecordEvent['type']
}): number => {
  let found = -1
  args.events.forEach((event, index) => {
    if (event.type === args.type) found = index
  })
  return found
}

export const stepsAfter = (args: { events: readonly RecordEvent[]; index: number }): number =>
  countAfter({ ...args, types: ['assistant-said'] })

export const turnsAfter = (args: { events: readonly RecordEvent[]; index: number }): number =>
  countAfter({ ...args, types: ['turn-started'] })
