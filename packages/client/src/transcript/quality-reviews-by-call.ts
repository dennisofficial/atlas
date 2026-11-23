import type { CallId, CodeQualityReviewedBody, Event } from '@dltech/atlas-core'

export function qualityReviewsByCall(
  events: readonly Event[],
): ReadonlyMap<CallId, readonly CodeQualityReviewedBody[]> {
  const byCall = new Map<CallId, CodeQualityReviewedBody[]>()

  for (const event of events) {
    if (event.type !== 'code-quality-reviewed') continue
    const held = byCall.get(event.callId)
    if (held === undefined) byCall.set(event.callId, [event])
    else held.push(event)
  }

  return byCall
}
