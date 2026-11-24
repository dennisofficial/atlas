import { describe, expect, it } from 'bun:test'

import {
  CallInterruptedError,
  EToolEffect,
  ToolDefinition,
  toCallId,
  toRunId,
  toThreadId,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { ESpan, ESpanOutcome } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'
import { z } from 'zod'

import { HookChain } from '../../hooks/registry'
import { FakeTool } from '../../testing'
import { HookedToolDispatcher } from '../dispatch'
import { InMemoryToolRegistry } from '../registry'

const call = {
  callId: toCallId('call-1'),
  name: 'slow',
  input: {},
  runId: toRunId('run-1'),
  threadId: toThreadId('thread-1'),
}

class InterruptedTool extends ToolDefinition {
  readonly name = 'slow'
  readonly description = 'a tool a drain cut'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.unknown()

  async invoke(_args: ToolInvocation): Promise<ToolOutcome> {
    throw new CallInterruptedError('the command was interrupted before it finished')
  }
}

const dispatchUnder = async (args: {
  signal: AbortSignal
  tool?: ToolDefinition | undefined
}): Promise<RecordingTracer> => {
  const trace = new RecordingTracer()
  const dispatcher = new HookedToolDispatcher({
    registry: new InMemoryToolRegistry([args.tool ?? new FakeTool('slow', 'done')]),
    hooks: new HookChain({}),
    trace,
  })
  await trace
    .span({
      name: ESpan.Turn,
      root: true,
      run: () =>
        dispatcher.dispatch({ call, signal: args.signal, projectDirectory: '/repo', events: [] }),
    })
    .catch(() => undefined)
  return trace
}

describe('the tool span outcome', () => {
  it('is ok for a call that ran to its result', async () => {
    const trace = await dispatchUnder({ signal: new AbortController().signal })

    expect(trace.named(ESpan.Tool)[0]?.fields.outcome).toBe(ESpanOutcome.Ok)
  })

  it('is handoff for a call a drain cut, so the next host re-running it is not counted twice', async () => {
    const abort = new AbortController()
    abort.abort('handoff')

    const trace = await dispatchUnder({ signal: abort.signal })

    expect(trace.named(ESpan.Tool)[0]?.fields.outcome).toBe(ESpanOutcome.Handoff)
  })

  it('is handoff for a cut call that threw instead of returning its result', async () => {
    const abort = new AbortController()
    abort.abort('handoff')

    const trace = await dispatchUnder({ signal: abort.signal, tool: new InterruptedTool() })

    expect(trace.named(ESpan.Tool)[0]?.fields.outcome).toBe(ESpanOutcome.Handoff)
  })

  it('is error for a call that threw on a turn that was not handed off', async () => {
    const trace = await dispatchUnder({
      signal: new AbortController().signal,
      tool: new InterruptedTool(),
    })

    expect(trace.named(ESpan.Tool)[0]?.fields.outcome).toBe(ESpanOutcome.Error)
  })
})
