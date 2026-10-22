import { afterEach, describe, expect, it } from 'bun:test'

import { toCallId } from '@dltech/atlas-core'

import { createSettlePending } from '../settle-pending'
import {
  TOOLS,
  branchWithCalls,
  discardOpened,
  freshTrace,
  openLog,
  resultOrder,
  tracingDispatch,
} from './settle-parallel-fixture'

afterEach(discardOpened)

describe('settling a step whose calls may share a batch', () => {
  it('runs consecutive read-only calls at once rather than one after another', async () => {
    const harness = await openLog()
    const threadId = await branchWithCalls({
      harness,
      calls: [
        { callId: 'call-1', name: 'read' },
        { callId: 'call-2', name: 'read' },
        { callId: 'call-3', name: 'grep' },
      ],
    })
    const trace = freshTrace()
    const settle = createSettlePending({
      log: harness.log,
      dispatch: tracingDispatch({ trace }),
      tools: () => TOOLS,
    })

    await settle({ threadId, signal: new AbortController().signal })

    expect(trace.peakInFlight).toBe(3)
    expect(await resultOrder(harness, threadId)).toEqual(['call-1', 'call-2', 'call-3'])
  })

  it('appends each result as it lands, ahead of slower batch-mates', async () => {
    const harness = await openLog()
    const threadId = await branchWithCalls({
      harness,
      calls: [
        { callId: 'call-slow', name: 'read' },
        { callId: 'call-fast', name: 'read' },
      ],
    })
    const trace = freshTrace()
    const settle = createSettlePending({
      log: harness.log,
      dispatch: tracingDispatch({
        trace,
        holdFor: (call) => (call.callId === toCallId('call-slow') ? 150 : 10),
      }),
      tools: () => TOOLS,
    })

    const settling = settle({ threadId, signal: new AbortController().signal })
    await Bun.sleep(60)
    expect(trace.finished).toEqual(['call-fast'])
    expect(await resultOrder(harness, threadId)).toEqual(['call-fast'])
    await settling
    expect(await resultOrder(harness, threadId)).toEqual(['call-fast', 'call-slow'])
  })

  it('keeps a call that changes the world to itself', async () => {
    const harness = await openLog()
    const threadId = await branchWithCalls({
      harness,
      calls: [
        { callId: 'call-1', name: 'write' },
        { callId: 'call-2', name: 'write' },
      ],
    })
    const trace = freshTrace()
    const settle = createSettlePending({
      log: harness.log,
      dispatch: tracingDispatch({ trace }),
      tools: () => TOOLS,
    })

    await settle({ threadId, signal: new AbortController().signal })

    expect(trace.peakInFlight).toBe(1)
    expect(trace.finished).toEqual(['call-1', 'call-2'])
  })

  it('treats an unsafe call as a barrier the reads either side do not cross', async () => {
    const harness = await openLog()
    const threadId = await branchWithCalls({
      harness,
      calls: [
        { callId: 'read-a', name: 'read' },
        { callId: 'read-b', name: 'read' },
        { callId: 'the-write', name: 'write' },
        { callId: 'read-c', name: 'read' },
      ],
    })
    const trace = freshTrace()
    const settle = createSettlePending({
      log: harness.log,
      dispatch: tracingDispatch({ trace }),
      tools: () => TOOLS,
    })

    await settle({ threadId, signal: new AbortController().signal })

    expect(trace.peakInFlight).toBe(2)
    expect(trace.finished.indexOf('the-write')).toBeGreaterThan(trace.finished.indexOf('read-b'))
    expect(trace.finished.indexOf('read-c')).toBeGreaterThan(trace.finished.indexOf('the-write'))
  })

  it('settles one at a time when it knows nothing about the tools', async () => {
    const harness = await openLog()
    const threadId = await branchWithCalls({
      harness,
      calls: [
        { callId: 'call-1', name: 'read' },
        { callId: 'call-2', name: 'read' },
      ],
    })
    const trace = freshTrace()
    const settle = createSettlePending({ log: harness.log, dispatch: tracingDispatch({ trace }) })

    await settle({ threadId, signal: new AbortController().signal })

    expect(trace.peakInFlight).toBe(1)
  })

  it('runs every safe call of a step at once, with no cap to open a second batch', async () => {
    const harness = await openLog()
    const threadId = await branchWithCalls({
      harness,
      calls: Array.from({ length: 24 }, (_, index) => ({ callId: `call-${index}`, name: 'read' })),
    })
    const trace = freshTrace()
    const settle = createSettlePending({
      log: harness.log,
      dispatch: tracingDispatch({ trace }),
      tools: () => TOOLS,
    })

    await settle({ threadId, signal: new AbortController().signal })

    expect(trace.peakInFlight).toBe(24)
    expect(await resultOrder(harness, threadId)).toHaveLength(24)
  })

  it('stops before the next batch once the signal is aborted', async () => {
    const harness = await openLog()
    const threadId = await branchWithCalls({
      harness,
      calls: [
        { callId: 'call-write', name: 'write' },
        { callId: 'call-after', name: 'write' },
      ],
    })
    const controller = new AbortController()
    const trace = freshTrace()
    const settle = createSettlePending({
      log: harness.log,
      dispatch: tracingDispatch({
        trace,
        draftsFor: (call) => {
          controller.abort()
          return [{ type: 'tool-result', callId: call.callId, name: call.name, output: 'ok', modelText: 'ok' }]
        },
      }),
      tools: () => TOOLS,
    })

    await settle({ threadId, signal: controller.signal })

    expect(trace.started).toEqual(['call-write'])
  })

  it('stamps every result of a batch with the run that emitted its own call', async () => {
    const harness = await openLog()
    const thread = await harness.threads.create({})
    const firstRun = harness.ids.nextRunId()
    await harness.log.append({
      threadId: thread.id,
      runId: firstRun,
      drafts: [
        { type: 'user-said', text: 'go' },
        { type: 'assistant-said', parts: [{ type: 'text', text: 'working' }] },
        { type: 'tool-called', callId: toCallId('call-1'), name: 'read', input: {}, ordinal: 0 },
      ],
    })
    const secondRun = harness.ids.nextRunId()
    await harness.log.append({
      threadId: thread.id,
      runId: secondRun,
      drafts: [{ type: 'tool-called', callId: toCallId('call-2'), name: 'read', input: {}, ordinal: 1 }],
    })
    const settle = createSettlePending({
      log: harness.log,
      dispatch: tracingDispatch({ trace: freshTrace() }),
      tools: () => TOOLS,
    })

    await settle({ threadId: thread.id, signal: new AbortController().signal })

    const stamped = new Map(
      (await harness.log.read({ threadId: thread.id }))
        .filter((event) => event.type === 'tool-result')
        .map((event) => [event.type === 'tool-result' ? String(event.callId) : '', event.runId]),
    )
    expect(stamped.get('call-1')).toBe(firstRun)
    expect(stamped.get('call-2')).toBe(secondRun)
  })
})
