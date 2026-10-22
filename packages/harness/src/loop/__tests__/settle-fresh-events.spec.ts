import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { EToolEffect, toCallId, type Event, type EventDraft, type ToolDeclaration } from '@dltech/atlas-core'

import { ToolDispatcher, type DispatchableCall } from '../../tools/dispatch'
import { createSettlePending } from '../settle-pending'
import { branchWithCalls, discardOpened, openLog } from './settle-pending-fixture'

afterEach(discardOpened)

const SAFE_READ: ToolDeclaration = {
  name: 'read',
  description: 'the read tool',
  effect: EToolEffect.Read,
  inputSchema: z.object({}).loose(),
  isConcurrencySafe: () => true,
}

const resultOf = (call: DispatchableCall): EventDraft => ({
  type: 'tool-result',
  callId: call.callId,
  name: call.name,
  output: 'done',
  modelText: 'done',
})

class RecordingDispatcher extends ToolDispatcher {
  readonly seen: { callId: string; events: readonly Event[] }[] = []

  constructor(
    private readonly args: {
      draftsFor?: (call: DispatchableCall) => readonly EventDraft[]
      holdFor?: (call: DispatchableCall) => number
    } = {},
  ) {
    super()
  }

  async dispatch({
    call,
    events,
  }: {
    call: DispatchableCall
    events: readonly Event[]
  }): Promise<readonly EventDraft[]> {
    this.seen.push({ callId: String(call.callId), events })
    await Bun.sleep(this.args.holdFor?.(call) ?? 0)
    return this.args.draftsFor?.(call) ?? [resultOf(call)]
  }
}

const typesOf = (events: readonly Event[]): string[] => events.map((event) => event.type)

describe('settling calls that each need to see what the one before them wrote', () => {
  it('hands a serial call the results and nudges its predecessor appended', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [
        { callId: 'write-1', name: 'write' },
        { callId: 'write-2', name: 'write' },
      ],
    })
    const dispatch = new RecordingDispatcher({
      draftsFor: (call) => [
        resultOf(call),
        { type: 'nudge', text: `after ${call.callId}`, lifetimeSteps: 1 },
      ],
    })
    const settle = createSettlePending({ log: harness.log, dispatch })

    await settle({ threadId, signal: new AbortController().signal })

    const [first, second] = dispatch.seen
    expect(typesOf(first?.events ?? [])).toEqual([
      'user-said',
      'assistant-said',
      'tool-called',
      'tool-called',
    ])
    expect(typesOf(second?.events ?? [])).toEqual([
      'user-said',
      'assistant-said',
      'tool-called',
      'tool-called',
      'tool-result',
      'nudge',
    ])
  })

  it('dispatches each pending call exactly once however many rows settlement appends', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [
        { callId: 'write-1', name: 'write' },
        { callId: 'write-2', name: 'write' },
        { callId: 'write-3', name: 'write' },
      ],
    })
    const dispatch = new RecordingDispatcher()
    const settle = createSettlePending({ log: harness.log, dispatch })

    await settle({ threadId, signal: new AbortController().signal })

    expect(dispatch.seen.map((entry) => entry.callId)).toEqual(['write-1', 'write-2', 'write-3'])
  })

  it('gives every call of a safe batch the same snapshot, taken before any of them landed', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [
        { callId: 'read-1', name: 'read' },
        { callId: 'read-2', name: 'read' },
      ],
    })
    const dispatch = new RecordingDispatcher()
    const settle = createSettlePending({
      log: harness.log,
      dispatch,
      tools: () => [SAFE_READ],
    })

    await settle({ threadId, signal: new AbortController().signal })

    expect(dispatch.seen.map((entry) => entry.events.length)).toEqual([4, 4])
  })

  it('keeps completed read-only results durable before slower batch mates finish', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [
        { callId: 'read-slow', name: 'read' },
        { callId: 'read-fast', name: 'read' },
      ],
    })
    const dispatch = new RecordingDispatcher({
      holdFor: (call) => (call.callId === toCallId('read-slow') ? 80 : 0),
    })
    const settle = createSettlePending({
      log: harness.log,
      dispatch,
      tools: () => [SAFE_READ],
    })

    await settle({ threadId, signal: new AbortController().signal })

    const results = (await harness.log.read({ threadId })).filter((event) => event.type === 'tool-result')
    expect(results.map((event) => (event.type === 'tool-result' ? String(event.callId) : ''))).toEqual([
      'read-fast',
      'read-slow',
    ])
  })
})
