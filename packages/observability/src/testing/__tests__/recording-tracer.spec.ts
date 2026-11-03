import { describe, expect, it } from 'bun:test'

import { ESpan, ESpanMark } from '../../trace/trace.port'
import { RecordingTracer } from '../recording-tracer'

describe('RecordingTracer', () => {
  it('nests spans by async call chain, even when siblings run concurrently', async () => {
    const trace = new RecordingTracer()

    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: async () => {
        await Promise.all([
          trace.span({
            name: ESpan.Tool,
            fields: { tool: 'a' },
            run: async () => {
              await Bun.sleep(5)
              await trace.span({
                name: ESpan.ToolInvoke,
                fields: { tool: 'a' },
                run: async () => {},
              })
            },
          }),
          trace.span({
            name: ESpan.Tool,
            fields: { tool: 'b' },
            run: () =>
              trace.span({ name: ESpan.ToolInvoke, fields: { tool: 'b' }, run: async () => {} }),
          }),
        ])
      },
    })

    const [turn] = trace.named(ESpan.Turn)
    for (const invoke of trace.named(ESpan.ToolInvoke)) {
      expect(invoke.parent?.name).toBe(ESpan.Tool)
      expect(invoke.parent?.fields.tool).toBe(invoke.fields.tool)
      expect(invoke.parent?.parent).toBe(turn)
    }
    expect(trace.spans.every((span) => span.ended)).toBe(true)
  })

  it('records fields set mid-span, a mark once, and the class of a thrown error', async () => {
    const trace = new RecordingTracer()

    const failed = trace.span({
      name: ESpan.ModelCall,
      root: true,
      run: async (span) => {
        span.mark(ESpanMark.FirstChunk)
        span.mark(ESpanMark.FirstChunk)
        span.set({ outputTokens: 3 })
        throw new TypeError('secret path /home/x')
      },
    })

    await expect(failed).rejects.toThrow('secret path')
    const [call] = trace.spans
    expect(call?.marks).toEqual([ESpanMark.FirstChunk])
    expect(call?.fields.outputTokens).toBe(3)
    expect(call?.errorClass).toBe('TypeError')
  })
})

describe('RecordingTracer roots', () => {
  it('opens a fresh trace for a root inside another span and drops orphans', async () => {
    const trace = new RecordingTracer()

    await trace.span({ name: ESpan.RecordAppend, run: async () => {} })
    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: () => trace.span({ name: ESpan.Turn, root: true, run: async () => {} }),
    })

    expect(trace.named(ESpan.RecordAppend)).toEqual([])
    expect(trace.named(ESpan.Turn).map((span) => span.parent)).toEqual([undefined, undefined])
  })
})
