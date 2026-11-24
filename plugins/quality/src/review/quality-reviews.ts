import type { CodeQualityReviewedBody, Event } from '@dltech/atlas-core'

export function qualityReviewsOf(event: Event): readonly CodeQualityReviewedBody[] {
  if (event.type === 'code-quality-reviewed') return [event]
  if (event.type === 'tool-result') return event.qualityReviews ?? []
  return []
}
