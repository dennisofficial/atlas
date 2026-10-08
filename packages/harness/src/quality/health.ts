import {
  projectQualityHealth,
  type CodeQualityReviewedBody,
  type EventLogPort,
  type Event,
  type QualityHealth,
  type QualityHealthRecord,
  type ThreadId,
} from '@dltech/atlas-core'

export function qualityReviewsOf(event: Event): readonly CodeQualityReviewedBody[] {
  if (event.type === 'code-quality-reviewed') return [event]
  if (event.type === 'tool-result') return event.qualityReviews ?? []
  return []
}

export async function readQualityHealth({
  log,
  threadId,
}: {
  log: Pick<EventLogPort, 'readOwn'>
  threadId: ThreadId
}): Promise<QualityHealth> {
  const events = await log.readOwn({ threadId })
  const records: QualityHealthRecord[] = events.flatMap((event) =>
    qualityReviewsOf(event).map((record) => ({ ...record, at: event.at })),
  )
  return projectQualityHealth({ records })
}
