import { z } from 'zod'

import { md5Hex, splitRequestState } from './jev-label-state'
import type { JevLabelFrameRow } from './jev-label-sample'
import { chunkValues, type PosthogApi } from './posthog-api'

export const JEV_LABEL_STATE_BATCH = 10

const frameRowSchema = z.object({
  generation_id: z.string().min(1),
  trace_id: z.string().min(1),
  scope_id: z.string().min(1),
  policy_id: z.string().min(1),
  path: z.string().nullish(),
  verdict: z.string().min(1),
  impact: z.string().nullish(),
  timestamp: z.string().min(1),
})

const stateRowSchema = z.object({
  generation_id: z.string().min(1),
  content: z.string().nullish(),
  md5: z.string().nullish(),
})

const reviewedRowSchema = z.object({ trace_id: z.string().min(1) })

export const hogqlTimestamp = ({ iso }: { iso: string }): string => {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) throw new Error(`--since is not a timestamp: "${iso}"`)
  return parsed
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '')
}

export function frameQuery({ since, policyId }: { since: string; policyId: string }): string {
  const at = hogqlTimestamp({ iso: since })
  return `WITH gens AS (
  SELECT properties.review_id AS review_id, properties.scope_id AS scope_id, any(toString(uuid)) AS gen_id,
         any(properties.$ai_trace_id) AS trace_id, any(timestamp) AS ts, any(properties.path) AS path
  FROM events WHERE event = '$ai_generation' AND timestamp > toDateTime('${at}')
    AND properties.review_id IS NOT NULL AND NOT (properties.code_withheld = true)
  GROUP BY review_id, scope_id)
SELECT g.gen_id AS generation_id, g.trace_id AS trace_id, g.path AS path, toString(g.ts) AS timestamp,
       s.properties.scope_id AS scope_id, s.properties.policy_id AS policy_id,
       s.properties.impact AS impact, s.properties.verdict AS verdict
FROM events AS s INNER JOIN gens AS g ON s.properties.review_id = g.review_id AND s.properties.scope_id = g.scope_id
WHERE s.event = 'quality scope assessed' AND s.timestamp > toDateTime('${at}')
  AND s.properties.policy_id = '${policyId}'
LIMIT 10000`
}

export function stateQuery({ generationIds }: { generationIds: readonly string[] }): string {
  const ids = generationIds.map((id) => `'${id.replace(/'/g, '')}'`).join(',')
  return `SELECT toString(uuid) AS generation_id,
       JSONExtractString(input, 1, 'content') AS content,
       lower(hex(MD5(JSONExtractString(input, 1, 'content')))) AS md5
FROM posthog.ai_events WHERE toString(uuid) IN (${ids})`
}

export function parseFrameRows({
  rows,
}: {
  rows: readonly Record<string, unknown>[]
}): readonly JevLabelFrameRow[] {
  return rows.map((row) => {
    const parsed = frameRowSchema.parse(row)
    return {
      generationId: parsed.generation_id,
      traceId: parsed.trace_id,
      scopeId: parsed.scope_id,
      policyId: parsed.policy_id,
      path: parsed.path ?? null,
      verdict: parsed.verdict,
      impact: parsed.impact ?? null,
      timestamp: parsed.timestamp,
    }
  })
}

function verifyState({
  content,
  md5,
}: {
  content: string | null | undefined
  md5: string | null | undefined
}): { state: string; fault: null } | { state: null; fault: string } {
  if (content === undefined || content === null || content === '')
    return { state: null, fault: 'the call withheld its request state' }
  if (md5 !== md5Hex({ text: content }))
    return { state: null, fault: 'the stored request state does not match its md5' }
  try {
    return { state: splitRequestState({ content }), fault: null }
  } catch (fault) {
    return { state: null, fault: fault instanceof Error ? fault.message : String(fault) }
  }
}

export async function fetchVerifiedStates({
  api,
  generationIds,
}: {
  api: PosthogApi
  generationIds: readonly string[]
}): Promise<{ states: Map<string, string>; faults: Map<string, string> }> {
  const states = new Map<string, string>()
  const faults = new Map<string, string>()
  for (const batch of chunkValues({ values: generationIds, size: JEV_LABEL_STATE_BATCH })) {
    const rows = await api.hogql({ query: stateQuery({ generationIds: batch }) })
    for (const row of rows) {
      const parsed = stateRowSchema.parse(row)
      const verified = verifyState({ content: parsed.content, md5: parsed.md5 })
      if (verified.state === null) faults.set(parsed.generation_id, verified.fault)
      else states.set(parsed.generation_id, verified.state)
    }
    for (const id of batch)
      if (!states.has(id) && !faults.has(id)) faults.set(id, 'the call has no stored request state')
  }
  return { states, faults }
}

export async function reviewedTraces({
  api,
  scoreDefinitionId,
}: {
  api: PosthogApi
  scoreDefinitionId: string
}): Promise<ReadonlySet<string>> {
  const rows = await api.listAll({
    path: '/llm_analytics/trace_reviews/',
    query: { definition_id: scoreDefinitionId },
  })
  return new Set(rows.map((row) => reviewedRowSchema.parse(row).trace_id))
}
