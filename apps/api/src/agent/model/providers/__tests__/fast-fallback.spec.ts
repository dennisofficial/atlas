import { describe, expect, it } from 'bun:test'

import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4GenerateResult,
} from '@ai-sdk/provider'

import { EFastRefusal, fastRefusalOf, withFastFallback, type FastRefusal } from '../fast-fallback'
import { CALL_OPTIONS } from './provider-fixtures'

const generated = (text: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: 'end_turn' },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
})

const refusal = (args: { statusCode: number; message: string }): APICallError =>
  new APICallError({
    message: args.message,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: args.statusCode,
  })

const creditsRefusal = () =>
  refusal({ statusCode: 429, message: 'Usage credits are required for fast mode.' })

const harness = (args: {
  fast: () => LanguageModelV4GenerateResult
  standard: () => LanguageModelV4GenerateResult
  requested?: boolean
}) => {
  const calls: string[] = []
  const refusals: FastRefusal[] = []
  const model: LanguageModelV4 = withFastFallback({
    build: (fast) => ({
      specificationVersion: 'v4',
      provider: 'anthropic.messages',
      modelId: fast ? 'fast' : 'standard',
      supportedUrls: {},
      doGenerate: async () => {
        calls.push(fast ? 'fast' : 'standard')
        return fast ? args.fast() : args.standard()
      },
      doStream: async () => {
        throw new Error('unused')
      },
    }),
    requested: () => args.requested ?? true,
    onRefused: (body) => {
      refusals.push(body)
    },
  })
  return { model, calls, refusals }
}

describe('fastRefusalOf', () => {
  it('reads a status refusal that names usage credits as a credits refusal', () => {
    expect(fastRefusalOf(creditsRefusal())).toEqual({
      kind: EFastRefusal.CreditsRequired,
      status: 429,
      message: 'Usage credits are required for fast mode.',
    })
  })

  it('reads a bare rate limit as rate limited', () => {
    const body = fastRefusalOf(refusal({ statusCode: 529, message: 'Overloaded' }))

    expect(body?.kind).toBe(EFastRefusal.RateLimited)
    expect(body?.status).toBe(529)
  })

  it('finds a refusal wrapped in a cause chain', () => {
    const wrapped = new Error('the stream failed', { cause: creditsRefusal() })

    expect(fastRefusalOf(wrapped)?.kind).toBe(EFastRefusal.CreditsRequired)
  })

  it('reads nothing from an unrelated failure', () => {
    expect(fastRefusalOf(refusal({ statusCode: 400, message: 'messages: bad request' }))).toBe(
      undefined,
    )
  })
})

describe('withFastFallback', () => {
  it('reports a credits refusal and continues at standard speed', async () => {
    const run = harness({
      fast: () => {
        throw creditsRefusal()
      },
      standard: () => generated('standard reply'),
    })

    const result = await run.model.doGenerate(CALL_OPTIONS)

    expect(result).toEqual(generated('standard reply'))
    expect(run.calls).toEqual(['fast', 'standard'])
    expect(run.refusals).toHaveLength(1)
    expect(run.refusals[0]?.kind).toBe(EFastRefusal.CreditsRequired)
  })

  it('reports a bare rate limit and still continues at standard speed', async () => {
    const run = harness({
      fast: () => {
        throw refusal({ statusCode: 529, message: 'Overloaded' })
      },
      standard: () => generated('standard reply'),
    })

    await run.model.doGenerate(CALL_OPTIONS)

    expect(run.calls).toEqual(['fast', 'standard'])
    expect(run.refusals[0]?.kind).toBe(EFastRefusal.RateLimited)
  })

  it('keeps the refusal silent on a fast request that works', async () => {
    const run = harness({
      fast: () => generated('fast reply'),
      standard: () => generated('standard reply'),
    })

    const result = await run.model.doGenerate(CALL_OPTIONS)

    expect(result).toEqual(generated('fast reply'))
    expect(run.calls).toEqual(['fast'])
    expect(run.refusals).toEqual([])
  })

  it('rethrows a failure that is not a refusal without trying standard speed', async () => {
    const run = harness({
      fast: () => {
        throw refusal({ statusCode: 400, message: 'messages: bad request' })
      },
      standard: () => generated('standard reply'),
    })

    await expect(run.model.doGenerate(CALL_OPTIONS)).rejects.toThrow('messages: bad request')
    expect(run.calls).toEqual(['fast'])
    expect(run.refusals).toEqual([])
  })

  it('goes straight to standard speed when fast mode is off', async () => {
    const run = harness({
      fast: () => generated('fast reply'),
      standard: () => generated('standard reply'),
      requested: false,
    })

    const result = await run.model.doGenerate(CALL_OPTIONS)

    expect(result).toEqual(generated('standard reply'))
    expect(run.calls).toEqual(['standard'])
  })
})
