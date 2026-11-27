import { describe, expect, test } from 'vitest'

import { EQualityImpact } from '@dltech/atlas-core'

import { jevRealItemSchema } from '../jev-real'
import {
  EJevLabel,
  JEV_LABEL_INSTRUCTION,
  JEV_LABEL_MODELS,
  type JevLabelAnswer,
  type JevLabelMessages,
} from '../jev-label-answer'
import { runJevLabel, summarizeJevLabelRows } from '../jev-label'
import type { JevLabeller } from '../jev-label-gateway'
import { md5Hex } from '../jev-label-state'
import type { PosthogApi } from '../posthog-api'

const RUBRIC = '# rubric'

const stateOf = ({ path }: { path: string }): string =>
  JSON.stringify({
    scope: {
      before: null,
      after: `export function run() { return "${path}" }`,
      diff: `+export function run() { return "${path}" }`,
      dependencyContext: ['import { z } from "zod"'],
    },
  })

const contentOf = ({ state }: { state: string }): string =>
  `${state}\n\n${JSON.stringify({ 'single-responsibility:impact': { kind: 'choose' } })}`

type FrameRow = {
  generation_id: string
  trace_id: string
  scope_id: string
  policy_id: string
  path: string
  verdict: string
  impact: string
  timestamp: string
}

const frameRowOf = ({
  generationId,
  traceId,
  verdict,
}: {
  generationId: string
  traceId: string
  verdict: string
}): FrameRow => ({
  generation_id: generationId,
  trace_id: traceId,
  scope_id: `scope-${generationId}`,
  policy_id: 'single-responsibility',
  path: `src/${generationId}.ts`,
  verdict,
  impact: verdict === 'nudged' ? 'introduced' : 'unchanged',
  timestamp: '2026-11-27T12:00:00.000000Z',
})

const fakeApi = ({
  frameRows,
  states,
  reviewed = [],
  tamper = null,
}: {
  frameRows: readonly FrameRow[]
  states: Readonly<Record<string, string>>
  reviewed?: readonly string[]
  tamper?: string | null
}): PosthogApi => ({
  request: async () => {
    throw new Error('the labeller run must not call the REST routes')
  },
  hogql: async ({ query }) => {
    if (query.includes('posthog.ai_events')) {
      return Object.entries(states).map(([generationId, state]) => ({
        generation_id: generationId,
        content: contentOf({ state }),
        md5: tamper === generationId ? '0'.repeat(32) : md5Hex({ text: contentOf({ state }) }),
      }))
    }
    return frameRows
  },
  listAll: async () => reviewed.map((traceId) => ({ trace_id: traceId })),
})

const labellerOf = ({
  answer,
}: {
  answer: (args: { model: string; messages: JevLabelMessages }) => JevLabelAnswer
}): JevLabeller => {
  return async (args) => answer(args)
}

const agreeingLabeller: JevLabeller = labellerOf({
  answer: () => ({
    mixes: false,
    change_reasons: ['routing'],
    impact: EQualityImpact.Unchanged,
    label: EJevLabel.NoNudge,
    reason: 'one reason to change',
  }),
})

describe('runJevLabel', () => {
  test('skips reviewed traces and labels one item per remaining trace', async () => {
    const run = await runJevLabel({
      api: fakeApi({
        frameRows: [
          frameRowOf({ generationId: 'gen-a', traceId: 'trace-a', verdict: 'nudged' }),
          frameRowOf({ generationId: 'gen-b', traceId: 'trace-b', verdict: 'clean' }),
          frameRowOf({ generationId: 'gen-c', traceId: 'trace-c', verdict: 'clean' }),
        ],
        states: {
          'gen-a': stateOf({ path: 'a' }),
          'gen-b': stateOf({ path: 'b' }),
          'gen-c': stateOf({ path: 'c' }),
        },
        reviewed: ['trace-c'],
      }),
      labeller: agreeingLabeller,
      since: '2026-11-27T12:00:00Z',
      rubric: RUBRIC,
      nearMiss: 5,
      random: 5,
      models: JEV_LABEL_MODELS,
      labelledAt: '2026-11-27T13:00:00.000Z',
    })
    expect(run.rows.map((row) => row.source_trace_id)).toEqual(['trace-a', 'trace-b'])
    expect(run.items.map((item) => item.client_item_id)).toEqual(['gen-a', 'gen-b'])
    expect(run.items[0]?.metadata.stratum).toBe('nudged')
    expect(run.items[1]?.metadata.stratum).toBe('random')
    expect(jevRealItemSchema.safeParse(run.items[0]).success).toBe(true)
    expect(run.items[0]?.source_timestamp).toBe('2026-11-27T12:00:00.000000Z')
    expect(run.rows[0]?.answers).toHaveLength(2)
  })

  test('stops an item whose stored state does not match its md5', async () => {
    const run = await runJevLabel({
      api: fakeApi({
        frameRows: [frameRowOf({ generationId: 'gen-a', traceId: 'trace-a', verdict: 'nudged' })],
        states: { 'gen-a': stateOf({ path: 'a' }) },
        tamper: 'gen-a',
      }),
      labeller: agreeingLabeller,
      since: '2026-11-27T12:00:00Z',
      rubric: RUBRIC,
    })
    expect(run.rows).toHaveLength(1)
    expect(run.rows[0]?.error).toContain('md5')
    expect(run.items).toEqual([])
    expect(summarizeJevLabelRows({ rows: run.rows }).errors).toBe(1)
  })

  test('keeps a disagreeing item out of the dataset', async () => {
    const run = await runJevLabel({
      api: fakeApi({
        frameRows: [frameRowOf({ generationId: 'gen-a', traceId: 'trace-a', verdict: 'clean' })],
        states: { 'gen-a': stateOf({ path: 'a' }) },
      }),
      labeller: labellerOf({
        answer: ({ model }) => ({
          mixes: false,
          change_reasons: [],
          impact: EQualityImpact.Unchanged,
          label: model === 'anthropic/claude-opus-5.5' ? EJevLabel.NoNudge : EJevLabel.Nudge,
          reason: 'split call',
        }),
      }),
      since: '2026-11-27T12:00:00Z',
      rubric: RUBRIC,
      models: JEV_LABEL_MODELS,
    })
    expect(run.rows[0]?.agreed).toBe(false)
    expect(run.rows[0]?.label).toBe(EJevLabel.Unsure)
    expect(run.items).toEqual([])
    expect(summarizeJevLabelRows({ rows: run.rows }).agreement).toBe(0)
  })

  test('sends the rubric and the scope fields to both models, never Jev output', async () => {
    const seen: JevLabelMessages[] = []
    await runJevLabel({
      api: fakeApi({
        frameRows: [frameRowOf({ generationId: 'gen-a', traceId: 'trace-a', verdict: 'nudged' })],
        states: { 'gen-a': stateOf({ path: 'a' }) },
      }),
      labeller: labellerOf({
        answer: ({ messages }) => {
          seen.push(messages)
          return {
            mixes: false,
            change_reasons: [],
            impact: EQualityImpact.Unchanged,
            label: EJevLabel.NoNudge,
            reason: 'cohesive',
          }
        },
      }),
      since: '2026-11-27T12:00:00Z',
      rubric: RUBRIC,
      models: JEV_LABEL_MODELS,
    })
    expect(seen).toHaveLength(2)
    expect(seen[0]?.system).toBe(RUBRIC)
    expect(seen[0]?.user).toContain('Path: src/gen-a.ts')
    expect(seen[0]?.user).toContain('## AFTER')
    expect(seen[0]?.user).toContain(JEV_LABEL_INSTRUCTION)
    expect(seen[0]?.user).not.toContain('verdict')
  })
})
