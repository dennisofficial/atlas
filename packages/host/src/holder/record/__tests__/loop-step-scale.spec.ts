import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  awaitsReplyOf,
  chainEvents,
  pendingCallsOf,
  projectDirectoryOfState,
  resumePlanOf,
  toCallId,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'

import { RecordCache } from '../record-cache'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-06T12:00:00.000Z'
const RUNS = 21
const BATCH = 1000

const bodiesOf = (args: { start: number; count: number }): V2Body[] =>
  Array.from({ length: args.count }, (_, offset): V2Body => {
    const index = args.start + offset
    const callId = toCallId(`call-${Math.floor(index / 4)}`)
    switch (index % 4) {
      case 0:
        return { type: 'user-said', text: `ask ${index}` }
      case 1:
        return { type: 'tool-called', callId, name: 'bash', input: { index }, ordinal: 0 }
      case 2:
        return { type: 'tool-result', callId, name: 'bash', output: { index } }
      default:
        return { type: 'assistant-said', parts: [{ type: 'text', text: `reply ${index}` }] }
    }
  })

const cacheOf = async (size: number): Promise<RecordCache> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const cache = await RecordCache.load({ plane, threadId: THREAD })
  for (let start = 0; start < size; start += BATCH) {
    const events = chainEvents({
      threadId: THREAD,
      runId: toRunId('run-1'),
      epoch: 1,
      at: AT,
      bodies: bodiesOf({ start, count: Math.min(BATCH, size - start) }),
      from: cache.currentHead(),
    })
    const last = events[events.length - 1]
    if (last === undefined) throw new Error('no events chained')
    cache.extend({ events, head: { seq: last.seq, hash: cache.currentHead().hash } })
  }
  return cache
}

const stepReads = (cache: RecordCache): number => {
  const state = cache.loopState()
  const lastSeq = state.lastSeq ?? 0
  return [
    pendingCallsOf(state).length,
    awaitsReplyOf(state) ? 1 : 0,
    resumePlanOf(state).kind.length,
    projectDirectoryOfState({ state, launchDirectory: '/w' }).length,
    cache.loopEventsAfter(state.lastUserSaidSeq ?? 0).length,
    cache.loopEventsAfter(lastSeq - 4).length,
  ].reduce((sum, value) => sum + value, 0)
}

const medianMs = (cache: RecordCache): number => {
  stepReads(cache)
  const samples = Array.from({ length: RUNS }, () => {
    const started = performance.now()
    stepReads(cache)
    return performance.now() - started
  }).sort((left, right) => left - right)
  return samples[Math.floor(RUNS / 2)] ?? 0
}

describe('a loop step on a long thread', () => {
  it('costs about the same at 20k events as at 1k', async () => {
    const small = await cacheOf(1000)
    const large = await cacheOf(20_000)
    expect(large.loopState().lastSeq).toBe(20_000)

    const t1k = medianMs(small)
    const t20k = medianMs(large)
    console.log(`loop step reads: 1k=${t1k.toFixed(4)}ms 20k=${t20k.toFixed(4)}ms`)

    expect(t20k).toBeLessThanOrEqual(Math.max(2 * t1k, t1k + 5))
  }, 60_000)
})
