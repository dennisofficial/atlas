import { z } from 'zod'

import {
  EQualityImpact,
  EQualityLanguage,
  EQualityScopeKind,
  type DecisionOutcome,
  type DecisionQuestion,
  type QualityPolicy,
  type QualityScope,
} from '@dltech/atlas-core'
import {
  applyAssessments,
  interpretQualityResponse,
  prepareQualityRequest,
} from '@dltech/atlas-plugin-quality/review'

import { JevDecisionClient } from './jev-decision-client'
import type { JevRealMetricRow } from './jev-real-metrics'

export const JEV_REAL_MODEL = 'typesafe-ai/jev-1.14.0'
export const JEV_REAL_GATEWAY_URL = 'https://ai-gateway.vercel.sh/typesafe'
export const JEV_REAL_TIMEOUT_MS = 15_000

export class JevRealItemError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JevRealItemError'
  }
}

const recordedEvidenceSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  changed: z.boolean(),
})

const recordedStateSchema = z.object({
  scope: z.object({
    before: z.string().nullable(),
    after: z.string().nullable(),
    diff: z.string(),
    dependencyContext: z.array(z.string()),
    evidence: z.array(recordedEvidenceSchema),
  }),
})

export const jevRealItemSchema = z.object({
  id: z.string().min(1).optional(),
  client_item_id: z.string().min(1).optional(),
  source_trace_id: z.string().min(1).nullish(),
  input: z.object({ state: z.string().min(1) }),
  expected_output: z.object({ notify: z.boolean(), impact: z.enum(EQualityImpact) }),
  metadata: z.object({
    stratum: z.string().min(1),
    inclusion_probability: z.number().gt(0).max(1),
    scope_id: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    policy_id: z.string().min(1).optional(),
  }),
})

export type JevRealItem = z.infer<typeof jevRealItemSchema>

export type JevRealDecide = (args: {
  state: string
  questions: Record<string, DecisionQuestion>
  signal: AbortSignal
  model: string
}) => Promise<DecisionOutcome>

export type JevRealRow = JevRealMetricRow & {
  itemId: string
  sourceTraceId: string | null
  stratum: string
  path: string | null
  expected: { notify: boolean; impact: EQualityImpact }
  actual: {
    notify: boolean
    impact: EQualityImpact
    transition: string | null
    status: string
    currentConcern: number | null
    detail: string | null
  } | null
  notifyMatch: boolean
  impactMatch: boolean
}

export function parseJevRealItems({ text }: { text: string }): readonly JevRealItem[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) throw new JevRealItemError('the item file holds no JSON lines')
  return lines.map((line, index) => {
    let decoded: unknown
    try {
      decoded = JSON.parse(line)
    } catch {
      throw new JevRealItemError(`item ${index + 1} is not valid JSON`)
    }
    const parsed = jevRealItemSchema.safeParse(decoded)
    if (!parsed.success) {
      const problem = parsed.error.issues[0]
      throw new JevRealItemError(
        `item ${index + 1} is not a dataset item: ${problem?.path.join('.') ?? ''} ${problem?.message ?? 'invalid'}`,
      )
    }
    return parsed.data
  })
}

function interpretationScope({
  item,
  state,
}: {
  item: JevRealItem
  state: z.infer<typeof recordedStateSchema>
}): QualityScope {
  const scopeId = item.metadata.scope_id ?? item.client_item_id ?? item.id ?? 'jev-real-item'
  return {
    id: scopeId,
    workspaceNamespace: 'jev-real-eval',
    path: item.metadata.path ?? 'recorded-scope',
    language: EQualityLanguage.TypeScript,
    kind: EQualityScopeKind.Module,
    name: '',
    adapterVersion: 'jev-real-eval',
    structuralHash: scopeId,
    parentScopeId: null,
    lineRange: null,
    before: state.scope.before,
    after: state.scope.after,
    diff: state.scope.diff,
    beforeHash: null,
    afterHash: null,
    evidence: state.scope.evidence,
    dependencyContext: state.scope.dependencyContext,
    beforeLineRange: null,
    afterLineRange: null,
  }
}

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

function rowOf({
  item,
  expected,
  error,
}: {
  item: JevRealItem
  expected: JevRealRow['expected']
  error: string | null
}): JevRealRow {
  return {
    itemId: item.client_item_id ?? item.id ?? 'unnamed-item',
    sourceTraceId: item.source_trace_id ?? null,
    stratum: item.metadata.stratum,
    inclusionProbability: item.metadata.inclusion_probability,
    path: item.metadata.path ?? null,
    expected,
    actual: null,
    notifyMatch: false,
    impactMatch: false,
    error,
  }
}

export async function runJevRealItem({
  item,
  policies,
  decide,
  model = JEV_REAL_MODEL,
}: {
  item: JevRealItem
  policies: readonly QualityPolicy[]
  decide: JevRealDecide
  model?: string
}): Promise<JevRealRow> {
  const expected = { notify: item.expected_output.notify, impact: item.expected_output.impact }
  try {
    const state = recordedStateSchema.parse(JSON.parse(item.input.state))
    const scope = interpretationScope({ item, state })
    const request = prepareQualityRequest({ scope, policies })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), JEV_REAL_TIMEOUT_MS)
    let outcome: DecisionOutcome
    try {
      outcome = await decide({
        state: item.input.state,
        questions: request.questions,
        signal: controller.signal,
        model,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!outcome.ok)
      return rowOf({ item, expected, error: `decision call failed: ${outcome.fault}` })
    if (outcome.model !== model)
      return rowOf({
        item,
        expected,
        error: `model identity mismatch: requested ${model} but the decision resolved ${outcome.model ?? 'no model identity'}`,
      })
    const assessments = interpretQualityResponse({
      request,
      scope,
      policies,
      answers: outcome.answers,
    })
    const led = applyAssessments({
      previous: [],
      assessments,
      afterHash: scope.afterHash,
      scopeDeleted: false,
    })
    const assessment = assessments[0]
    const notify = led.notifiable.length > 0
    const impact = assessment?.impact ?? EQualityImpact.Uncertain
    return {
      itemId: item.client_item_id ?? item.id ?? 'unnamed-item',
      sourceTraceId: item.source_trace_id ?? null,
      stratum: item.metadata.stratum,
      inclusionProbability: item.metadata.inclusion_probability,
      path: item.metadata.path ?? null,
      expected,
      actual: {
        notify,
        impact,
        transition: assessment?.transition ?? null,
        status: assessment?.status ?? 'no-assessment',
        currentConcern: assessment?.currentConcernProbability ?? null,
        detail: assessment?.detail ?? null,
      },
      notifyMatch: notify === expected.notify,
      impactMatch: impact === expected.impact,
      error: null,
    }
  } catch (fault) {
    return rowOf({ item, expected, error: messageOf(fault) })
  }
}

export function createGatewayDecider({ apiKey }: { apiKey: string }): JevRealDecide {
  const client = new JevDecisionClient({
    config: () => ({ baseUrl: JEV_REAL_GATEWAY_URL, token: apiKey }),
    timeoutMs: JEV_REAL_TIMEOUT_MS,
  })
  return (args) => client.decide(args)
}

export const formatJevRealRow = ({ row }: { row: JevRealRow }): string => JSON.stringify(row)
