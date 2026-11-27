import { createHash } from 'node:crypto'

import type { EQualityImpact } from '@dltech/atlas-core'

import { JEV_REAL_MODEL } from './jev-real'
import type { JevLabelItem, JevLabelRow } from './jev-label-row'

export type JevRealOutcome = {
  itemId: string
  notifyMatch: boolean
  impactMatch: boolean
  actual: {
    notify: boolean
    impact: EQualityImpact
    transition: string | null
    status: string
    currentConcern: number | null
  } | null
}

export const JEV_PUBLISH_BATCH = 200
export const JEV_PUBLISH_SUITE_KEY = 'single-responsibility-real'
export const JEV_PUBLISH_APPLICATION_VERSION = 'single-responsibility@1'
export const JEV_PUBLISH_EXPERIMENT_MODEL = JEV_REAL_MODEL
export const JEV_PUBLISH_REVIEW_BATCH = 20

export function uuidFromKey({ key }: { key: string }): string {
  const hex = createHash('sha256').update(key).digest('hex')
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

const answerLine = ({ row, index }: { row: JevLabelRow; index: number }): string => {
  const answer = row.answers[index]
  if (answer === undefined) return 'no answer'
  return `${answer.label} (impact ${answer.impact}): ${answer.reason}`
}

export function traceReviewComment({ row }: { row: JevLabelRow }): string {
  const head = row.agreed
    ? `Two blind labellers agreed: ${row.label} (impact ${row.impact}).`
    : `Two blind labellers did not agree, so this trace is unsure.`
  return [
    head,
    `Stratum ${row.stratum}.`,
    `A: ${answerLine({ row, index: 0 })}`,
    `B: ${answerLine({ row, index: 1 })}`,
  ].join(' ')
}

export function traceReviewBody({
  row,
  scoreDefinitionId,
}: {
  row: JevLabelRow
  scoreDefinitionId: string
}) {
  return {
    trace_id: row.source_trace_id,
    comment: traceReviewComment({ row }),
    scores: [{ definition_id: scoreDefinitionId, categorical_values: [row.label] }],
  }
}

export function reviewQueueItemBody({
  row,
  reviewQueueId,
}: {
  row: JevLabelRow
  reviewQueueId: string
}) {
  return { queue_id: reviewQueueId, trace_id: row.source_trace_id }
}

export function datasetItemBody({ item, datasetId }: { item: JevLabelItem; datasetId: string }) {
  return {
    dataset: datasetId,
    client_item_id: item.client_item_id,
    input: item.input,
    expected_output: item.expected_output,
    metadata: item.metadata,
    source_trace_id: item.source_trace_id,
    source_event_id: item.client_item_id,
    source_timestamp: item.source_timestamp,
  }
}

export function experimentSubmission({
  experimentId,
  name,
  startedAt,
  datasetId,
  datasetRevisionIdentifier,
  itemCount,
  resultCount,
}: {
  experimentId: string
  name: string
  startedAt: string
  datasetId: string
  datasetRevisionIdentifier: string
  itemCount: number
  resultCount: number
}) {
  return {
    id: experimentId,
    name,
    started_at: startedAt,
    run_source: 'scheduled',
    expected_item_count: itemCount,
    expected_result_count: resultCount,
    suite_key: JEV_PUBLISH_SUITE_KEY,
    dataset_source: 'posthog-dataset',
    dataset_identifier: datasetId,
    dataset_revision_identifier: datasetRevisionIdentifier,
    application_version: JEV_PUBLISH_APPLICATION_VERSION,
    model_version: JEV_PUBLISH_EXPERIMENT_MODEL,
  }
}

export const experimentItemId = ({ clientItemId }: { clientItemId: string }): string =>
  uuidFromKey({ key: `item:${clientItemId}` })

export function experimentItemBody({
  row,
  item,
  result,
}: {
  row: JevLabelRow
  item: JevLabelItem
  result: JevRealOutcome | undefined
}) {
  const actual = result?.actual
  return {
    id: experimentItemId({ clientItemId: row.client_item_id }),
    model_version: JEV_PUBLISH_EXPERIMENT_MODEL,
    case_key: row.client_item_id,
    dataset_item_identifier: row.client_item_id,
    application_trace_id: row.source_trace_id,
    payload: {
      output:
        actual === null || actual === undefined
          ? null
          : {
              notify: actual.notify,
              impact: actual.impact,
              transition: actual.transition,
              status: actual.status,
              current_concern: actual.currentConcern,
            },
      expected_output: item.expected_output,
      metadata: {
        ...item.metadata,
        notify_match: result?.notifyMatch ?? null,
        impact_match: result?.impactMatch ?? null,
      },
    },
  }
}

export function experimentResultBody({
  row,
  itemId,
  scorerVersionId,
  result,
}: {
  row: JevLabelRow
  itemId: string
  scorerVersionId: string
  result: JevRealOutcome | undefined
}) {
  return {
    item_id: itemId,
    scorer_version_id: scorerVersionId,
    status: 'ok',
    value: [row.label],
    evaluated_at: row.labelled_at,
    payload: {
      reasoning: traceReviewComment({ row }),
      metadata: {
        stratum: row.stratum,
        inclusion_probability: row.inclusion_probability,
        verdict: row.verdict,
        jev_impact: row.jev_impact,
        notify_match: result?.notifyMatch ?? null,
        impact_match: result?.impactMatch ?? null,
      },
    },
  }
}
