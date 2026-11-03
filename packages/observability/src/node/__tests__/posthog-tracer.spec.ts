import { describe, expect, it } from 'bun:test'
import { PostHog } from 'posthog-node'

import { ESpan, ESpanMark } from '../../trace/trace.port'
import { PosthogTracer } from '../posthog-tracer'

type OtlpSpan = {
  name: string
  spanId: string
  parentSpanId?: string
  attributes?: { key: string; value: Record<string, unknown> }[]
  events?: { name: string }[]
  status?: { code: number; message?: string }
}

const capturingClient = (): { client: PostHog; spans: () => OtlpSpan[] } => {
  const bodies: string[] = []
  const client = new PostHog('phc_test', {
    host: 'https://posthog.invalid',
    disableCompression: true,
    flushAt: 1,
    traces: { serviceName: 'atlas-spec' },
    fetch: async (url, options) => {
      if (url.includes('/i/v1/traces') && typeof options.body === 'string')
        bodies.push(options.body)
      return { status: 200, text: async () => '{}', json: async () => ({}) }
    },
  })
  const spans = (): OtlpSpan[] =>
    bodies.flatMap((body) => {
      const payload = JSON.parse(body) as {
        resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[]
      }
      return payload.resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      )
    })
  return { client, spans }
}

const attribute = (span: OtlpSpan | undefined, key: string): unknown => {
  const value = span?.attributes?.find((entry) => entry.key === key)?.value
  return value === undefined ? undefined : Object.values(value)[0]
}

describe('PosthogTracer', () => {
  it('starts a new trace for a root span opened inside another trace', async () => {
    const { client, spans } = capturingClient()
    const trace = new PosthogTracer({ client, distinctId: 'anon-1' })

    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: () => trace.span({ name: ESpan.Turn, root: true, run: async () => {} }),
    })
    await trace.span({ name: ESpan.RecordAppend, run: async () => {} })
    await client.shutdown(2000)

    expect(spans().map((span) => span.name)).toEqual([ESpan.Turn, ESpan.Turn])
    expect(spans().every((span) => span.parentSpanId === undefined)).toBe(true)
  })

  it('exports nested spans with fields, marks and the anonymous id', async () => {
    const { client, spans } = capturingClient()
    const trace = new PosthogTracer({ client, distinctId: 'anon-1' })

    const value = await trace.span({
      name: ESpan.Turn,
      root: true,
      fields: { provider: 'anthropic' },
      run: () =>
        trace.span({
          name: ESpan.ModelCall,
          run: async (span) => {
            span.mark(ESpanMark.FirstChunk)
            span.set({ outputTokens: 12 })
            return 'answer'
          },
        }),
    })
    await client.shutdown(2000)

    expect(value).toBe('answer')
    const turn = spans().find((span) => span.name === ESpan.Turn)
    const call = spans().find((span) => span.name === ESpan.ModelCall)
    expect(call?.parentSpanId).toBe(turn?.spanId)
    expect(attribute(turn, 'provider')).toBe('anthropic')
    expect(attribute(turn, 'posthogDistinctId')).toBe('anon-1')
    expect(Number(attribute(call, 'outputTokens'))).toBe(12)
    expect(call?.events?.map((event) => event.name)).toEqual([ESpanMark.FirstChunk])
    expect(attribute(call, 'first_chunk_ms')).toBeDefined()
  })

  it('rethrows a failure but exports only its class, never its message', async () => {
    const { client, spans } = capturingClient()
    const trace = new PosthogTracer({ client, distinctId: 'anon-1' })

    const failed = trace.span({
      name: ESpan.ToolInvoke,
      root: true,
      run: async () => {
        throw new RangeError('rm -rf /home/dennis/secret')
      },
    })
    await expect(failed).rejects.toThrow('rm -rf')
    await client.shutdown(2000)

    const [invoke] = spans()
    expect(invoke?.status?.code).toBe(2)
    expect(attribute(invoke, 'error.class')).toBe('RangeError')
    expect(JSON.stringify(spans())).not.toContain('secret')
  })
})
