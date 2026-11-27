import { z } from 'zod'

import type { JevLabelItem, JevLabelRow } from './jev-label-row'
import {
  JEV_PUBLISH_BATCH,
  JEV_PUBLISH_REVIEW_BATCH,
  datasetItemBody,
  experimentItemId,
  experimentItemBody,
  experimentResultBody,
  experimentSubmission,
  reviewQueueItemBody,
  traceReviewBody,
  uuidFromKey,
  type JevRealOutcome,
} from './jev-publish-bodies'
import { PosthogApiError, type PosthogApi } from './posthog-api'

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
const definitionSchema = z.object({ current_version_id: z.string().min(1) })

const chunk = <T>({ values, size }: { values: readonly T[]; size: number }): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size))
  return chunks
}

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

const isDuplicate = ({ fault }: { fault: unknown }): boolean =>
  fault instanceof PosthogApiError &&
  /client_item_id|duplicate|unique|already exists/i.test(fault.detail)

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
  for (const batch of chunk({ values: traceIds, size: JEV_PUBLISH_REVIEW_BATCH })) {
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

export async function fetchScorerVersionId({
  api,
  scoreDefinitionId,
}: {
  api: PosthogApi
  scoreDefinitionId: string
}): Promise<string> {
  const raw = await api.request({
    method: 'GET',
    path: `/llm_analytics/score_definitions/${scoreDefinitionId}/`,
  })
  return definitionSchema.parse(raw).current_version_id
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

export async function existingDatasetItemIds({
  api,
  datasetId,
}: {
  api: PosthogApi
  datasetId: string
}): Promise<ReadonlySet<string>> {
  const rows = await api.listAll({ path: '/dataset_items/', query: { dataset: datasetId } })
  return new Set(
    rows.flatMap((row) =>
      typeof row.client_item_id === 'string' && row.client_item_id !== ''
        ? [row.client_item_id]
        : [],
    ),
  )
}

export async function publishDatasetItems({
  api,
  items,
  datasetId,
}: {
  api: PosthogApi
  items: readonly JevLabelItem[]
  datasetId: string
}): Promise<{ created: number; skipped: number; failures: string[] }> {
  const existing = await existingDatasetItemIds({ api, datasetId })
  let created = 0
  let skipped = 0
  const failures: string[] = []
  for (const item of items) {
    if (existing.has(item.client_item_id)) {
      skipped += 1
      continue
    }
    try {
      await api.request({
        method: 'POST',
        path: '/dataset_items/',
        body: datasetItemBody({ item, datasetId }),
      })
      created += 1
    } catch (fault) {
      if (isDuplicate({ fault })) {
        skipped += 1
        continue
      }
      failures.push(`${item.client_item_id}: ${messageOf(fault)}`)
    }
  }
  return { created, skipped, failures }
}

export async function publishExperiment({
  api,
  rows,
  items,
  results,
  scoreDefinitionId,
  datasetId,
  name,
  startedAt,
}: {
  api: PosthogApi
  rows: readonly JevLabelRow[]
  items: readonly JevLabelItem[]
  results: readonly JevRealOutcome[]
  scoreDefinitionId: string
  datasetId: string
  name: string
  startedAt: string
}): Promise<{
  experimentId: string
  uploadedItems: number
  uploadedResults: number
  failures: string[]
}> {
  const scorerVersionId = await fetchScorerVersionId({ api, scoreDefinitionId })
  const details = new Map(items.map((item) => [item.client_item_id, item]))
  const resultByItem = new Map(results.map((result) => [result.itemId, result]))
  const labellable = rows.filter((row) => details.has(row.client_item_id))
  const experimentId = uuidFromKey({ key: `experiment:${name}:${startedAt}` })
  await api.request({
    method: 'POST',
    path: '/ai_observability/offline_experiments/',
    body: experimentSubmission({
      experimentId,
      name,
      startedAt,
      datasetId,
      datasetRevisionIdentifier: `routine-${startedAt.slice(0, 10)}-${labellable.length}-items`,
      itemCount: labellable.length,
      resultCount: labellable.length,
    }),
  })

  const failures: string[] = []
  let uploadedItems = 0
  let uploadedResults = 0
  for (const batch of chunk({ values: labellable, size: JEV_PUBLISH_BATCH })) {
    const uploadItems = batch.map((row) =>
      experimentItemBody({
        row,
        item: details.get(row.client_item_id) as JevLabelItem,
        result: resultByItem.get(row.client_item_id),
      }),
    )
    const uploadResults = batch.map((row) =>
      experimentResultBody({
        row,
        itemId: experimentItemId({ clientItemId: row.client_item_id }),
        scorerVersionId,
        result: resultByItem.get(row.client_item_id),
      }),
    )
    try {
      await api.request({
        method: 'POST',
        path: `/ai_observability/offline_experiments/${experimentId}/upload/`,
        body: { items: uploadItems, results: uploadResults },
      })
      uploadedItems += uploadItems.length
      uploadedResults += uploadResults.length
    } catch (fault) {
      failures.push(`upload ${uploadedItems}: ${messageOf(fault)}`)
      break
    }
  }
  if (failures.length === 0)
    await api.request({
      method: 'POST',
      path: `/ai_observability/offline_experiments/${experimentId}/complete/`,
    })
  return { experimentId, uploadedItems, uploadedResults, failures }
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
