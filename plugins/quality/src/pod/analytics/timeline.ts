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

const SUBAGENT_RUN_STARTS: readonly RecordEvent['type'][] = ['user-said', 'input-consumed']

const indicesOfTypes = (args: {
  events: readonly RecordEvent[]
  types: readonly RecordEvent['type'][]
}): readonly number[] =>
  args.events.flatMap((event, index) => (args.types.includes(event.type) ? [index] : []))

export const turnStartIndicesOf = (args: { events: readonly RecordEvent[] }): readonly number[] => {
  const turns = indicesOfTypes({ events: args.events, types: ['turn-started'] })
  if (turns.length > 0) return turns
  return indicesOfTypes({ events: args.events, types: SUBAGENT_RUN_STARTS })
}

export const lastTurnStartOf = (args: { events: readonly RecordEvent[] }): number =>
  turnStartIndicesOf(args).at(-1) ?? -1

export const stepsAfter = (args: { events: readonly RecordEvent[]; index: number }): number =>
  countAfter({ ...args, types: ['assistant-said'] })

export const turnsAfter = (args: { events: readonly RecordEvent[]; index: number }): number =>
  turnStartIndicesOf(args).filter((start) => start > args.index).length
