import {
  projectQualityHealth,
  type EventLogPort,
  type EventOfType,
  type QualityHealth,
  type QualityHealthRecord,
  type ThreadId,
} from '@dltech/atlas-core'

export const isQualityReviewEvent = (event: { type: string }): event is EventOfType<'code-quality-reviewed'> =>
  event.type === 'code-quality-reviewed'

export async function readQualityHealth({
  log,
  threadId,
}: {
  log: Pick<EventLogPort, 'readOwn'>
  threadId: ThreadId
}): Promise<QualityHealth> {
  const events = await log.readOwn({ threadId })
  const records: QualityHealthRecord[] = events.filter(isQualityReviewEvent).map((event) => ({ ...event, at: event.at }))
  return projectQualityHealth({ records })
}
