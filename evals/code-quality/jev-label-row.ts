import { z } from 'zod'

import { EQualityImpact } from '@dltech/atlas-core'

import { jevRealItemSchema } from './jev-real'
import {
  EJevLabel,
  labelMessages,
  labelView,
  resolveJevLabel,
  type JevLabelAnswer,
  type JevLabelMessages,
  type JevLabelVerdict,
} from './jev-label-answer'
import type { JevLabeller } from './jev-label-gateway'
import { EJevLabelStratum, type JevLabelStratumSample } from './jev-label-sample'
import { readScopeState } from './jev-label-state'

export type JevLabelModelAnswer = {
  model: string
  label: EJevLabel
  impact: EQualityImpact
  mixes: boolean
  changeReasons: readonly string[]
  reason: string
}

export type JevLabelRow = {
  client_item_id: string
  source_trace_id: string
  policy_id: string
  scope_id: string
  path: string | null
  stratum: EJevLabelStratum
  inclusion_probability: number
  timestamp: string
  verdict: string
  jev_impact: string | null
  label: EJevLabel
  agreed: boolean
  impact: EQualityImpact
  impact_disputed: readonly EQualityImpact[] | null
  answers: readonly JevLabelModelAnswer[]
  labelled_at: string
  error: string | null
}

export type JevLabelItem = {
  client_item_id: string
  source_trace_id: string
  source_timestamp: string
  input: { state: string }
  expected_output: { notify: boolean; impact: EQualityImpact }
  metadata: Record<string, unknown>
}

export const jevLabelRowSchema = z.object({
  client_item_id: z.string().min(1),
  source_trace_id: z.string().min(1),
  policy_id: z.string().min(1),
  scope_id: z.string().min(1),
  path: z.string().nullable(),
  stratum: z.enum(EJevLabelStratum),
  inclusion_probability: z.number().gt(0).max(1),
  timestamp: z.string().min(1),
  verdict: z.string().min(1),
  jev_impact: z.string().nullable(),
  label: z.enum(EJevLabel),
  agreed: z.boolean(),
  impact: z.enum(EQualityImpact),
  impact_disputed: z.array(z.enum(EQualityImpact)).nullable(),
  answers: z.array(
    z.object({
      model: z.string().min(1),
      label: z.enum(EJevLabel),
      impact: z.enum(EQualityImpact),
      mixes: z.boolean(),
      changeReasons: z.array(z.string()),
      reason: z.string(),
    }),
  ),
  labelled_at: z.string().min(1),
  error: z.string().nullable(),
})

export function messagesOf({
  sample,
  state,
  rubric,
}: {
  sample: JevLabelStratumSample
  state: string
  rubric: string
}): JevLabelMessages {
  const scope = readScopeState({ state })
  return labelMessages({ rubric, view: labelView({ path: sample.row.path, scope }) })
}

export async function labelSample({
  sample,
  state,
  models,
  rubric,
  labeller,
}: {
  sample: JevLabelStratumSample
  state: string
  models: readonly string[]
  rubric: string
  labeller: JevLabeller
}): Promise<readonly JevLabelAnswer[]> {
  const messages = messagesOf({ sample, state, rubric })
  return Promise.all(models.map(async (model) => labeller({ model, messages })))
}

const noVerdict = (): JevLabelVerdict => ({
  label: EJevLabel.Unsure,
  notify: false,
  agreed: false,
  impact: EQualityImpact.Uncertain,
  impactDisputed: null,
})

export function rowOf({
  sample,
  answers,
  models,
  labelledAt,
  error,
}: {
  sample: JevLabelStratumSample
  answers: readonly JevLabelAnswer[]
  models: readonly string[]
  labelledAt: string
  error: string | null
}): JevLabelRow {
  const verdict = answers.length === 0 ? noVerdict() : resolveJevLabel({ answers })
  return {
    client_item_id: sample.row.generationId,
    source_trace_id: sample.row.traceId,
    policy_id: sample.row.policyId,
    scope_id: sample.row.scopeId,
    path: sample.row.path,
    stratum: sample.stratum,
    inclusion_probability: sample.inclusionProbability,
    timestamp: sample.row.timestamp,
    verdict: sample.row.verdict,
    jev_impact: sample.row.impact,
    label: verdict.label,
    agreed: verdict.agreed,
    impact: verdict.impact,
    impact_disputed: verdict.impactDisputed,
    answers: answers.map((answer, index) => ({
      model: models[index] ?? 'unknown',
      label: answer.label,
      impact: answer.impact,
      mixes: answer.mixes,
      changeReasons: answer.change_reasons,
      reason: answer.reason,
    })),
    labelled_at: labelledAt,
    error,
  }
}

export function itemOf({ row, state }: { row: JevLabelRow; state: string }): JevLabelItem {
  const item: JevLabelItem = {
    client_item_id: row.client_item_id,
    source_trace_id: row.source_trace_id,
    source_timestamp: row.timestamp,
    input: { state },
    expected_output: { notify: row.label === EJevLabel.Nudge, impact: row.impact },
    metadata: {
      stratum: row.stratum,
      inclusion_probability: row.inclusion_probability,
      scope_id: row.scope_id,
      policy_id: row.policy_id,
      labelled_at: row.labelled_at,
      ...(row.path === null ? {} : { path: row.path }),
      ...(row.impact_disputed === null ? {} : { impact_disputed: row.impact_disputed }),
    },
  }
  jevRealItemSchema.parse(item)
  return item
}

export const formatJevLabelRow = ({ row }: { row: JevLabelRow }): string => JSON.stringify(row)

export function parseJevLabelRows({ text }: { text: string }): readonly JevLabelRow[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => jevLabelRowSchema.parse(JSON.parse(line) as unknown))
}
