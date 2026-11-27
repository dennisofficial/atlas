import { describe, expect, test } from 'vitest'

import { EQualityImpact } from '@dltech/atlas-core'

import { EJevLabel } from '../jev-label-answer'
import type { JevLabelItem, JevLabelRow } from '../jev-label-row'
import { EJevLabelStratum } from '../jev-label-sample'
import {
  datasetItemBody,
  experimentItemId,
  experimentSubmission,
  uuidFromKey,
} from '../jev-publish-bodies'
import { publishJevLabels } from '../jev-publish'
import { PosthogApiError, type PosthogApi, type PosthogRequest } from '../posthog-api'

const rowOf = ({
  clientItemId,
  label,
  agreed = true,
  stratum = EJevLabelStratum.Random,
}: {
  clientItemId: string
  label: EJevLabel
  agreed?: boolean
  stratum?: EJevLabelStratum
}): JevLabelRow => ({
  client_item_id: clientItemId,
  source_trace_id: `trace-${clientItemId}`,
  policy_id: 'single-responsibility',
  scope_id: `scope-${clientItemId}`,
  path: `src/${clientItemId}.ts`,
  stratum,
  inclusion_probability: 0.25,
  timestamp: '2026-11-27T12:00:00.000000Z',
  verdict: 'clean',
  jev_impact: 'unchanged',
  label,
  agreed,
  impact: EQualityImpact.Unchanged,
  impact_disputed: null,
  answers: [
    {
      model: 'anthropic/claude-opus-5.5',
      label,
      impact: EQualityImpact.Unchanged,
      mixes: false,
      changeReasons: ['routing'],
      reason: 'one reason to change',
    },
  ],
  labelled_at: '2026-11-27T13:00:00.000Z',
  error: null,
})

const itemOf = ({ clientItemId }: { clientItemId: string }): JevLabelItem => ({
  client_item_id: clientItemId,
  source_trace_id: `trace-${clientItemId}`,
  source_timestamp: '2026-11-27T12:00:00.000000Z',
  input: { state: '{"scope":{}}' },
  expected_output: { notify: false, impact: EQualityImpact.Unchanged },
  metadata: { stratum: 'random', inclusion_probability: 0.25 },
})

const recordingApi = ({
  existing = [],
  duplicates = [],
  pending = [],
}: {
  existing?: readonly (readonly [string, string])[]
  duplicates?: readonly string[]
  pending?: readonly string[]
}): { api: PosthogApi; calls: PosthogRequest[] } => {
  const calls: PosthogRequest[] = []
  const api: PosthogApi = {
    request: async (args) => {
      calls.push(args)
      if (args.method === 'GET' && args.path === '/llm_analytics/trace_reviews/')
        return { results: existing.map(([traceId, id]) => ({ trace_id: traceId, id })) }
      if (args.method === 'GET' && args.path.startsWith('/llm_analytics/score_definitions/'))
        return { current_version_id: 'version-1' }
      const body = args.body as { client_item_id?: string } | undefined
      if (
        args.method === 'POST' &&
        args.path === '/dataset_items/' &&
        duplicates.includes(body?.client_item_id ?? '')
      )
        throw new PosthogApiError({
          status: 400,
          path: args.path,
          detail: 'client_item_id must be unique in the dataset',
        })
      return {}
    },
    hogql: async () => [],
    listAll: async ({ path }) => {
      if (path === '/dataset_items/')
        return duplicates.map((clientItemId) => ({ client_item_id: clientItemId }))
      if (path === '/llm_analytics/review_queue_items/')
        return pending.map((traceId) => ({ trace_id: traceId }))
      return []
    },
  }
  return { api, calls }
}

const publishOf = ({
  api,
  rows,
  items,
  results,
}: {
  api: PosthogApi
  rows: readonly JevLabelRow[]
  items: readonly JevLabelItem[]
  results?: Parameters<typeof publishJevLabels>[0]['results']
}) =>
  publishJevLabels({
    api,
    rows,
    items,
    scoreDefinitionId: 'definition-1',
    datasetId: 'dataset-1',
    reviewQueueId: 'queue-1',
    experimentName: results === undefined ? null : 'run one',
    startedAt: '2026-11-27T15:00:00.000Z',
    ...(results === undefined ? {} : { results }),
  })

describe('uuidFromKey', () => {
  test('is stable and shaped like a UUID', () => {
    const first = uuidFromKey({ key: 'item:a' })
    expect(first).toBe(uuidFromKey({ key: 'item:a' }))
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(first).not.toBe(uuidFromKey({ key: 'item:b' }))
  })
})

describe('publishJevLabels', () => {
  test('creates a review per trace and updates the one that exists', async () => {
    const { api, calls } = recordingApi({ existing: [['trace-gen-a', 'review-1']] })
    const outcome = await publishOf({
      api,
      rows: [rowOf({ clientItemId: 'gen-a', label: EJevLabel.NoNudge })],
      items: [itemOf({ clientItemId: 'gen-a' })],
    })
    const patch = calls.find((call) => call.method === 'PATCH')
    expect(patch?.path).toBe('/llm_analytics/trace_reviews/review-1/')
    expect(patch?.body).toMatchObject({
      scores: [{ definition_id: 'definition-1', categorical_values: [EJevLabel.NoNudge] }],
    })
    expect(outcome.reviewsUpdated).toBe(1)
    expect(outcome.reviewsCreated).toBe(0)
  })

  test('posts a new review when the models agree', async () => {
    const { api, calls } = recordingApi({})
    const outcome = await publishOf({
      api,
      rows: [rowOf({ clientItemId: 'gen-b', label: EJevLabel.Nudge })],
      items: [],
    })
    const review = calls.find(
      (call) => call.method === 'POST' && call.path === '/llm_analytics/trace_reviews/',
    )
    expect(review?.body).toMatchObject({
      trace_id: 'trace-gen-b',
      scores: [{ definition_id: 'definition-1', categorical_values: [EJevLabel.Nudge] }],
    })
    expect(outcome.reviewsCreated).toBe(1)
  })

  test('queues a disagreeing trace instead of reviewing it', async () => {
    const { api, calls } = recordingApi({})
    const outcome = await publishOf({
      api,
      rows: [rowOf({ clientItemId: 'gen-b', label: EJevLabel.Unsure, agreed: false })],
      items: [],
    })
    const queued = calls.find((call) => call.path === '/llm_analytics/review_queue_items/')
    expect(queued?.body).toEqual({ queue_id: 'queue-1', trace_id: 'trace-gen-b' })
    expect(outcome.queued).toBe(1)
    expect(outcome.reviewsCreated).toBe(0)
    expect(
      calls.some((call) => call.method === 'POST' && call.path === '/llm_analytics/trace_reviews/'),
    ).toBe(false)
  })

  test('writes a dataset item and skips one the dataset already holds', async () => {
    const { api, calls } = recordingApi({ duplicates: ['gen-a'] })
    const outcome = await publishOf({
      api,
      rows: [rowOf({ clientItemId: 'gen-a', label: EJevLabel.NoNudge })],
      items: [itemOf({ clientItemId: 'gen-a' }), itemOf({ clientItemId: 'gen-b' })],
    })
    expect(outcome.itemsCreated).toBe(1)
    expect(outcome.itemsSkipped).toBe(1)
    const created = calls.filter(
      (call) => call.method === 'POST' && call.path === '/dataset_items/',
    )
    expect(created).toHaveLength(1)
    expect(created[0]?.body).toEqual(
      datasetItemBody({ item: itemOf({ clientItemId: 'gen-b' }), datasetId: 'dataset-1' }),
    )
  })

  test('records the label as the experiment result and completes it', async () => {
    const { api, calls } = recordingApi({})
    const outcome = await publishOf({
      api,
      rows: [rowOf({ clientItemId: 'gen-a', label: EJevLabel.Nudge })],
      items: [itemOf({ clientItemId: 'gen-a' })],
      results: [
        {
          itemId: 'gen-a',
          notifyMatch: true,
          impactMatch: false,
          actual: {
            notify: true,
            impact: EQualityImpact.Worsened,
            transition: 'track_debt',
            status: 'decided',
            currentConcern: 0.91,
          },
        },
      ],
    })
    const created = calls.find((call) => call.path === '/ai_observability/offline_experiments/')
    expect(created?.body).toMatchObject({
      name: 'run one',
      run_source: 'scheduled',
      suite_key: 'single-responsibility-real',
      model_version: 'typesafe-ai/jev-1.14.0',
      dataset_identifier: 'dataset-1',
      expected_item_count: 1,
      expected_result_count: 1,
    })
    const upload = calls.find((call) => call.path?.endsWith('/upload/'))
    const body = upload?.body as {
      items: readonly { id: string; payload: { output: unknown } }[]
      results: readonly { item_id: string; value: readonly string[] }[]
    }
    expect(body.items[0]?.id).toBe(experimentItemId({ clientItemId: 'gen-a' }))
    expect(body.items[0]?.payload.output).toMatchObject({ notify: true, current_concern: 0.91 })
    expect(body.results[0]?.item_id).toBe(body.items[0]?.id)
    expect(body.results[0]?.value).toEqual([EJevLabel.Nudge])
    expect(calls.some((call) => call.path?.endsWith('/complete/'))).toBe(true)
    expect(outcome.experimentId).not.toBeNull()
  })

  test('creates no experiment without replayed results', async () => {
    const { api, calls } = recordingApi({})
    const outcome = await publishOf({
      api,
      rows: [rowOf({ clientItemId: 'gen-a', label: EJevLabel.NoNudge })],
      items: [itemOf({ clientItemId: 'gen-a' })],
    })
    expect(outcome.experimentId).toBeNull()
    expect(calls.some((call) => call.path === '/ai_observability/offline_experiments/')).toBe(false)
  })

  test('reports a failure instead of throwing it', async () => {
    const { api, calls } = recordingApi({})
    const failing: PosthogApi = {
      ...api,
      request: async (args) => {
        if (args.path === '/dataset_items/')
          throw new PosthogApiError({ status: 500, path: args.path, detail: 'boom' })
        return api.request(args)
      },
    }
    const outcome = await publishOf({
      api: failing,
      rows: [rowOf({ clientItemId: 'gen-a', label: EJevLabel.NoNudge })],
      items: [itemOf({ clientItemId: 'gen-a' })],
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.itemsCreated).toBe(0)
  })
})

describe('publishJevLabels queues', () => {
  test('does not queue a trace the queue already holds', async () => {
    const { api, calls } = recordingApi({ pending: ['trace-gen-b'] })
    const outcome = await publishOf({
      api,
      rows: [rowOf({ clientItemId: 'gen-b', label: EJevLabel.Unsure, agreed: false })],
      items: [],
    })
    expect(calls.some((call) => call.path === '/llm_analytics/review_queue_items/')).toBe(false)
    expect(outcome.queued).toBe(1)
    expect(outcome.failures).toEqual([])
  })
})

describe('experimentSubmission', () => {
  test('pins the suite, the dataset and the item counts', () => {
    expect(
      experimentSubmission({
        experimentId: 'experiment-1',
        name: 'run one',
        startedAt: '2026-11-27T15:00:00.000Z',
        datasetId: 'dataset-1',
        datasetRevisionIdentifier: 'routine-2026-11-27-3-items',
        itemCount: 3,
        resultCount: 3,
      }),
    ).toMatchObject({
      id: 'experiment-1',
      expected_item_count: 3,
      dataset_revision_identifier: 'routine-2026-11-27-3-items',
      application_version: 'single-responsibility@1',
    })
  })
})
