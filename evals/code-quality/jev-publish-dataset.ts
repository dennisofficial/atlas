import { z } from 'zod'

import type { JevLabelItem, JevLabelRow } from './jev-label-row'
import {
  JEV_PUBLISH_BATCH,
  datasetItemBody,
  experimentItemBody,
  experimentItemId,
  experimentResultBody,
  experimentSubmission,
  uuidFromKey,
  type JevRealOutcome,
} from './jev-publish-bodies'
import { chunkValues, messageOf, PosthogApiError, type PosthogApi } from './posthog-api'

const definitionSchema = z.object({ current_version_id: z.string().min(1) })

const isDuplicate = ({ fault }: { fault: unknown }): boolean =>
  fault instanceof PosthogApiError &&
  /client_item_id|duplicate|unique|already exists/i.test(fault.detail)

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
  for (const batch of chunkValues({ values: labellable, size: JEV_PUBLISH_BATCH })) {
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
