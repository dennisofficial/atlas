import { describe, expect, it } from 'bun:test'

import type { CapturedFileChange, ClassifierCallContext } from '@dltech/atlas-core'
import { EClassifierFault } from '@dltech/atlas-core'
import { EAnalyticsLinks, type PodClassifier } from '@dltech/atlas-plugin-sdk'

import { JEV_QUALITY_MODEL } from '../../review/request'
import { tracedClassifier } from '../traced-classifier'
import {
  analyticsRecorder,
  completedOf,
  createRig,
  FILE,
  PROJECT,
  type Captured,
  wroteWithChanges,
} from './support'

const CONTEXT: ClassifierCallContext = {
  path: 'src/widget.ts',
  scopeId: 'scope-1',
  policyIds: ['single-responsibility'],
  lineStart: 1,
  lineEnd: 9,
}

const GATEWAY_STATUS = {
  on: true,
  model: 'jev-latest',
  provider: 'jev',
  pricing: {
    endpoint: 'https://ai-gateway.vercel.sh/typesafe',
    inputUsdPerMillion: 0.042,
    outputUsdPerMillion: 0,
  },
} as const

const generationsOf = (captured: readonly Captured[]): readonly Captured[] =>
  captured.filter((one) => one.event === '$ai_generation')

type ContentRecord = { role: string; content: string }

const inputOf = (one: Captured): readonly ContentRecord[] =>
  one.properties.$ai_input as readonly ContentRecord[]

const outputsOf = (one: Captured): readonly ContentRecord[] | undefined =>
  one.properties.$ai_output_choices as readonly ContentRecord[] | undefined

const answeringClassifier = (): PodClassifier => ({
  status: () => ({ on: true, model: 'jev-latest', provider: 'jev' }),
  classify: async () => ({
    ok: true,
    answers: { 'single-responsibility:concern': { noul: 0.2 } },
    model: 'jev-latest',
    usage: { inputTokens: 1_000_000, outputTokens: 250 },
  }),
})

const tracingOf = (
  classifier: PodClassifier = answeringClassifier(),
): { captured: Captured[]; traced: PodClassifier } => {
  const recorder = analyticsRecorder()
  let now = 0
  const traced = tracedClassifier({
    classifier,
    analytics: recorder.analytics,
    reviewId: 'review-1',
    status: GATEWAY_STATUS,
    clock: () => (now += 25),
  })
  return { captured: recorder.captured, traced }
}

const classifyWith = async ({
  traced,
  context,
  state = 'the state',
}: {
  traced: PodClassifier
  context?: ClassifierCallContext | undefined
  state?: string | undefined
}): Promise<void> => {
  await traced.classify({
    state,
    questions: {},
    signal: new AbortController().signal,
    context,
  })
}

describe('the traced classifier', () => {
  it('sends one generation per classify call with the trace id, cost and code', async () => {
    const { captured, traced } = tracingOf()

    await classifyWith({ traced, context: CONTEXT })
    await classifyWith({ traced, context: CONTEXT })

    const generations = generationsOf(captured)
    expect(generations).toHaveLength(2)
    const first = generations[0]!
    expect(first.properties).toMatchObject({
      $ai_trace_id: 'review-1',
      $ai_span_name: 'jev:single-responsibility',
      $ai_model: 'jev-latest',
      $ai_provider: 'jev',
      $ai_base_url: 'https://ai-gateway.vercel.sh/typesafe',
      $ai_input_tokens: 1_000_000,
      $ai_output_tokens: 250,
      $ai_input_cost_usd: 0.042,
      $ai_output_cost_usd: 0,
      $ai_total_cost_usd: 0.042,
      $ai_is_error: false,
      $ai_error: null,
      review_id: 'review-1',
      scope_id: 'scope-1',
      policy_ids: ['single-responsibility'],
      path: 'src/widget.ts',
      line_start: 1,
      line_end: 9,
      code_withheld: null,
    })
    expect(first.properties.$ai_span_id).not.toBe(generations[1]?.properties.$ai_span_id)
    expect(Number(first.properties.$ai_latency)).toBeGreaterThan(0)
    expect(first.links).toBe(EAnalyticsLinks.Hashed)
    expect(inputOf(first)[0]?.content).toBe('the state\n\n{}')
    expect(outputsOf(first)?.[0]?.content).toBe(
      JSON.stringify({ 'single-responsibility:concern': { noul: 0.2 } }),
    )
  })

  it('withholds the code when the path looks secret and keeps the metadata', async () => {
    const { captured, traced } = tracingOf()

    await classifyWith({ traced, context: { ...CONTEXT, path: '.env' } })

    const generation = generationsOf(captured)[0]!
    expect(generation.properties.code_withheld).toBe('secret')
    expect(generation.properties.$ai_input).toBeUndefined()
    expect(generation.properties.$ai_output_choices).toBeUndefined()
    expect(generation.properties).toMatchObject({
      $ai_trace_id: 'review-1',
      review_id: 'review-1',
      scope_id: 'scope-1',
      $ai_input_tokens: 1_000_000,
    })
  })

  it('withholds the code when the state holds a secret literal', async () => {
    const { captured, traced } = tracingOf()

    await classifyWith({ traced, context: CONTEXT, state: 'const key = "sk-abcdefgh1234"' })

    const generation = generationsOf(captured)[0]!
    expect(generation.properties.code_withheld).toBe('secret')
    expect(generation.properties.$ai_input).toBeUndefined()
    expect(generation.properties.$ai_output_choices).toBeUndefined()
  })

  it('reports an aborted call as an error with the fault kind', async () => {
    const classifier: PodClassifier = {
      status: () => ({ on: true, model: 'jev-latest', provider: 'jev' }),
      classify: async () => ({
        ok: false,
        fault: EClassifierFault.Aborted,
        detail: 'the turn was interrupted',
      }),
    }
    const { captured, traced } = tracingOf(classifier)

    await classifyWith({ traced, context: CONTEXT })

    const generation = generationsOf(captured)[0]!
    expect(generation.properties).toMatchObject({
      $ai_is_error: true,
      $ai_error: 'aborted',
      $ai_input_tokens: null,
      $ai_output_tokens: null,
      $ai_total_cost_usd: 0,
    })
    expect(generation.properties.$ai_output_choices).toBeUndefined()
  })
})

const SECRET_AFTER =
  'export class Widget {\n  run() {\n    return 1\n  }\n\n  audit() {\n    return "sk-abcdefgh1234"\n  }\n}\n'

const secretChange: CapturedFileChange = {
  path: FILE,
  before: 'export class Widget {\n  run() {\n    return 1\n  }\n}\n',
  after: SECRET_AFTER,
}

describe('the generation the review hook sends', () => {
  it('shares its trace id with the review event and asks for hashed links', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run()

    const generations = generationsOf(captured)
    expect(generations).toHaveLength(1)
    const reviewId = String(completedOf(captured)?.properties.review_id)
    const generation = generations[0]!
    expect(generation.properties).toMatchObject({
      $ai_trace_id: reviewId,
      review_id: reviewId,
      $ai_span_name: 'jev:single-responsibility',
      $ai_model: JEV_QUALITY_MODEL,
      $ai_provider: 'jev',
      policy_ids: ['single-responsibility'],
      path: 'src/widget.ts',
      code_withheld: null,
      $ai_is_error: false,
    })
    expect(typeof generation.properties.$ai_span_id).toBe('string')
    expect(typeof generation.properties.scope_id).toBe('string')
    expect(String(inputOf(generation)[0]?.content)).toContain('"scope"')
    expect(generation.links).toBe(EAnalyticsLinks.Hashed)
  })

  it('withholds the code of a write that lands a secret literal', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run({ result: wroteWithChanges({ fileChanges: [secretChange] }) })

    const generations = generationsOf(captured)
    expect(generations.length).toBeGreaterThan(0)
    for (const generation of generations) {
      expect(generation.properties.code_withheld).toBe('secret')
      expect(generation.properties.$ai_input).toBeUndefined()
      expect(generation.properties.$ai_output_choices).toBeUndefined()
      expect(generation.properties.path).toBe('src/widget.ts')
    }
  })

  it('sends nothing when the tool captured no change', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run({
      projectDirectory: PROJECT,
      result: wroteWithChanges({ fileChanges: [] }),
    })

    expect(generationsOf(captured)).toEqual([])
  })
})
