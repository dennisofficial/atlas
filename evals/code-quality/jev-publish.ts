import { z } from 'zod'

import type { JevLabelItem, JevLabelRow } from './jev-label-row'
import { publishDatasetItems, publishExperiment } from './jev-publish-dataset'
import {
  JEV_PUBLISH_REVIEW_BATCH,
  reviewQueueItemBody,
  traceReviewBody,
  type JevRealOutcome,
} from './jev-publish-bodies'
import { chunkValues, messageOf, type PosthogApi } from './posthog-api'

export type JevPublishCounts = {
  reviewsCreated: number
  reviewsUpdated: number
  queued: number
  itemsCreated: number
  itemsSkipped: number
  experimentId: string | null
  experimentItems: number
  experimentResults: number
}

export type JevPublishOutcome = JevPublishCounts & { failures: readonly string[] }

const reviewSchema = z.object({ id: z.string().min(1), trace_id: z.string().min(1) })

export async function existingReviews({
  api,
  rows,
  scoreDefinitionId,
}: {
  api: PosthogApi
  rows: readonly JevLabelRow[]
  scoreDefinitionId: string
}): Promise<ReadonlyMap<string, string>> {
  const byTrace = new Map<string, string>()
  const traceIds = [...new Set(rows.map((row) => row.source_trace_id))]
  for (const batch of chunkValues({ values: traceIds, size: JEV_PUBLISH_REVIEW_BATCH })) {
    const raw = await api.request({
      method: 'GET',
      path: '/llm_analytics/trace_reviews/',
      query: { definition_id: scoreDefinitionId, trace_id__in: batch.join(',') },
    })
    const page = z.object({ results: z.array(reviewSchema) }).parse(raw)
    for (const review of page.results) byTrace.set(review.trace_id, review.id)
  }
  return byTrace
}

export async function pendingQueueTraces({
  api,
  reviewQueueId,
}: {
  api: PosthogApi
  reviewQueueId: string
}): Promise<ReadonlySet<string>> {
  const rows = await api.listAll({
    path: '/llm_analytics/review_queue_items/',
    query: { queue_id: reviewQueueId },
  })
  return new Set(
    rows.flatMap((row) =>
      typeof row.trace_id === 'string' && row.trace_id !== '' ? [row.trace_id] : [],
    ),
  )
}

export async function publishTraceReviews({
  api,
  rows,
  scoreDefinitionId,
  reviewQueueId,
}: {
  api: PosthogApi
  rows: readonly JevLabelRow[]
  scoreDefinitionId: string
  reviewQueueId: string
}): Promise<{
  counts: Pick<JevPublishCounts, 'reviewsCreated' | 'reviewsUpdated' | 'queued'>
  failures: string[]
}> {
  const existing = await existingReviews({ api, rows, scoreDefinitionId })
  const pending = await pendingQueueTraces({ api, reviewQueueId })
  const counts = { reviewsCreated: 0, reviewsUpdated: 0, queued: 0 }
  const failures: string[] = []
  for (const row of rows) {
    try {
      // PostHog refuses to queue a trace that already holds a review and clears a pending queue
      // item when one is saved, so a disagreement reaches a person only as a queue item.
      if (!row.agreed) {
        if (!pending.has(row.source_trace_id))
          await api.request({
            method: 'POST',
            path: '/llm_analytics/review_queue_items/',
            body: reviewQueueItemBody({ row, reviewQueueId }),
          })
        counts.queued += 1
        continue
      }
      const body = traceReviewBody({ row, scoreDefinitionId })
      const reviewId = existing.get(row.source_trace_id)
      if (reviewId === undefined) {
        await api.request({ method: 'POST', path: '/llm_analytics/trace_reviews/', body })
        counts.reviewsCreated += 1
        continue
      }
      await api.request({
        method: 'PATCH',
        path: `/llm_analytics/trace_reviews/${reviewId}/`,
        body: { comment: body.comment, scores: body.scores },
      })
      counts.reviewsUpdated += 1
    } catch (fault) {
      failures.push(`${row.source_trace_id}: ${messageOf(fault)}`)
    }
  }
  return { counts, failures }
}

export async function publishJevLabels({
  api,
  rows,
  items,
  results = [],
  scoreDefinitionId,
  datasetId,
  reviewQueueId,
  experimentName,
  startedAt = new Date().toISOString(),
}: {
  api: PosthogApi
  rows: readonly JevLabelRow[]
  items: readonly JevLabelItem[]
  results?: readonly JevRealOutcome[]
  scoreDefinitionId: string
  datasetId: string
  reviewQueueId: string
  experimentName: string | null
  startedAt?: string
}): Promise<JevPublishOutcome> {
  const reviews = await publishTraceReviews({ api, rows, scoreDefinitionId, reviewQueueId })
  const dataset = await publishDatasetItems({ api, items, datasetId })
  const experiment =
    experimentName === null
      ? { experimentId: null, uploadedItems: 0, uploadedResults: 0, failures: [] }
      : await publishExperiment({
          api,
          rows,
          items,
          results,
          scoreDefinitionId,
          datasetId,
          name: experimentName,
          startedAt,
        })
  return {
    reviewsCreated: reviews.counts.reviewsCreated,
    reviewsUpdated: reviews.counts.reviewsUpdated,
    queued: reviews.counts.queued,
    itemsCreated: dataset.created,
    itemsSkipped: dataset.skipped,
    experimentId: experiment.experimentId,
    experimentItems: experiment.uploadedItems,
    experimentResults: experiment.uploadedResults,
    failures: [...reviews.failures, ...dataset.failures, ...experiment.failures],
  }
}
