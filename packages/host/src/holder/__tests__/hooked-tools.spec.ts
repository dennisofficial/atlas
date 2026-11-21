import { describe, expect, it } from 'bun:test'
import { HookChain } from '@dltech/atlas-agent'
import { FakeTool, fakeToolRegistry } from '@dltech/atlas-agent/testing'
import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'
import { ESpan, ESpanOutcome } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { hookedToolsOf } from '../hooked-tools'

const THREAD = toThreadId('thread-1')

const dispatchArgs = {
  call: {
    callId: toCallId('call-1'),
    name: 'read',
    input: {},
    runId: toRunId('run-1'),
    threadId: THREAD,
  },
  signal: new AbortController().signal,
  projectDirectory: '/w',
  events: [],
}

describe('hookedToolsOf', () => {
  it('spans a tool dispatch when the runtime carries a trace', async () => {
    const trace = new RecordingTracer()
    const dispatcher = hookedToolsOf({
      registry: fakeToolRegistry([new FakeTool('read', 'contents')]),
      hooks: new HookChain({}),
      trace,
    })

    await trace.span({ name: ESpan.Turn, root: true, run: () => dispatcher.dispatch(dispatchArgs) })

    const [span] = trace.named(ESpan.Tool)
    expect(span?.fields).toMatchObject({
      tool: 'read',
      callId: 'call-1',
      outcome: ESpanOutcome.Ok,
    })
    expect(trace.named(ESpan.ToolInvoke)).toHaveLength(1)
  })

  it('still dispatches with no trace at all', async () => {
    const dispatcher = hookedToolsOf({
      registry: fakeToolRegistry([new FakeTool('read', 'contents')]),
      hooks: new HookChain({}),
      trace: undefined,
    })

    const drafts = await dispatcher.dispatch(dispatchArgs)

    expect(drafts.some((draft) => draft.type === 'tool-result')).toBe(true)
  })
})
