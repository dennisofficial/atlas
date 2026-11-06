import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  ECompactionAnchor,
  ERetryReason,
  chainEvents,
  chainHash,
  toCallId,
  toRunId,
  toThreadId,
  visibleLoopEvents,
  workspaceRecordOf,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import type { FactLookup } from '../record-bookkeeping'
import { RecordCache } from '../record-cache'
import { spillForAppend } from '../record-spill'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-06T12:00:00.000Z'
const CALLS = ['call-a', 'call-b', 'call-c']
const FACT_KEYS = ['consult:1', 'consult:2', 'step:1:model', 'step:2:model']
const RETRY_KEYS = ['step:1:retry', 'step:2:retry', 'tool:retry']
const PREFIXES = ['consult:', 'step:', 'step:1:', 'tool:', 'none:']
const REPOS = ['/w', '/x']
const SPILL_BYTES = 64

type Picker = { int(bound: number): number; of<T>(items: readonly T[]): T }

const pickerOf = (seed: number): Picker => {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
  const int = (bound: number): number => Math.floor(next() * bound)
  return {
    int,
    of: <T>(items: readonly T[]): T => {
      const item = items[int(items.length)]
      if (item === undefined) throw new Error('picked from an empty list')
      return item
    },
  }
}

const valueOf = (pick: Picker): unknown =>
  pick.int(3) === 0 ? 'x'.repeat(SPILL_BYTES * 2) : { at: pick.int(1000) }

const historyEditOf = (args: { pick: Picker; headSeq: number }): V2Body => {
  const { pick, headSeq } = args
  if (pick.int(2) === 0) return { type: 'history-rewound', toSeq: pick.int(headSeq) }
  const fromSeq = 1 + pick.int(headSeq)
  return {
    type: 'history-summarised',
    fromSeq,
    throughSeq: fromSeq + pick.int(headSeq - fromSeq + 1),
    anchor: ECompactionAnchor.Prefix,
    summary: 'earlier work',
  }
}

const bodyOf = (args: { pick: Picker; headSeq: number }): V2Body => {
  const { pick } = args
  const callId = toCallId(pick.of(CALLS))
  switch (pick.int(13)) {
    case 0:
      return { type: 'user-said', text: `ask ${pick.int(100)}` }
    case 1:
      return { type: 'assistant-said', parts: [{ type: 'text', text: `reply ${pick.int(100)}` }] }
    case 2:
      return { type: 'tool-called', callId, name: 'bash', input: valueOf(pick), ordinal: 0 }
    case 3:
      return pick.int(2) === 0
        ? { type: 'tool-dispatched', callId, name: 'bash' }
        : { type: 'tool-dispatched', callId, name: 'bash', bootId: `boot-${pick.int(3)}` }
    case 4:
      return { type: 'tool-result', callId, name: 'bash', output: valueOf(pick) }
    case 5:
      return { type: 'fact-recorded', key: pick.of(FACT_KEYS), kind: 'fact', value: valueOf(pick) }
    case 6:
      return {
        type: 'retry-scheduled',
        key: pick.of(RETRY_KEYS),
        notBefore: AT,
        attempt: 1 + pick.int(3),
        reason: ERetryReason.Overloaded,
      }
    case 7: {
      const sha = `sha${pick.int(3)}`
      return {
        type: 'branches-observed',
        repo: pick.of(REPOS),
        head: sha,
        branches: [{ name: 'main', sha }],
        worktrees: [],
      }
    }
    case 8:
      return { type: 'workspace-prepare-failed', reason: 'clone failed', inboxHead: pick.int(5) }
    case 9:
      return { type: 'workspace-prepared' }
    default:
      if (args.headSeq === 0) return { type: 'user-said', text: 'first' }
      return historyEditOf(args)
  }
}

const openThread = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return { plane, epoch }
}

const commit = async (args: {
  plane: ControlPlane
  epoch: number
  cache: RecordCache
  bodies: readonly V2Body[]
}): Promise<void> => {
  const spilled = args.bodies.map((body) => spillForAppend({ body, thresholdBytes: SPILL_BYTES }))
  const events = chainEvents({
    threadId: THREAD,
    runId: toRunId('run-1'),
    epoch: args.epoch,
    at: AT,
    bodies: spilled.map((one) => one.body),
    from: args.cache.currentHead(),
  })
  const outcome = await args.plane.append({
    threadId: THREAD,
    epoch: args.epoch,
    events,
    blobs: spilled.flatMap((one) => one.blobs),
  })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  args.cache.extend({
    events,
    head: outcome.head,
    resolved: new Map(spilled.flatMap((one) => [...one.resolved])),
  })
  await args.cache.refillIfRevealed()
}

const viewOf = (cache: RecordCache) => {
  const book = cache.bookkeeping()
  const head = cache.currentHead()
  return {
    head,
    loop: cache.visibleLoopEvents(),
    tails: Array.from({ length: Math.ceil((head.seq + 1) / 5) }, (_, step) =>
      cache.loopEventsAfter(step * 5),
    ),
    dispatched: CALLS.map((callId) => book.findDispatched(callId)),
    facts: FACT_KEYS.map((key) => book.fact(key)),
    recalledFacts: PREFIXES.map((prefix) => book.factsWithPrefix(prefix)),
    retries: RETRY_KEYS.map((key) => book.retry(key)),
    recalledRetries: PREFIXES.map((prefix) => book.retriesWithPrefix(prefix)),
    branches: REPOS.map((repo) => book.lastObservation(repo)),
    workspace: book.workspace(),
    lastUserSaidSeq: book.lastUserSaidSeq(),
  }
}

const foldedViewOf = (cache: RecordCache) => {
  const events = cache.eventsAfter(0).map((event) => cache.resolvedEvent(event))
  const ofType = <T extends V2Event['type']>(type: T) =>
    events.filter((event): event is Extract<V2Event, { type: T }> => event.type === type)
  const facts = ofType('fact-recorded').map((event) => ({ key: event.key, value: event.value }))
  const retries = ofType('retry-scheduled').map(({ key, notBefore, attempt, reason }) => ({
    key,
    notBefore,
    attempt,
    reason,
  }))
  return {
    loop: visibleLoopEvents(events),
    dispatched: CALLS.map((callId) => {
      const hit = ofType('tool-dispatched').findLast((event) => event.callId === callId)
      return hit === undefined ? undefined : { bootId: hit.bootId }
    }),
    facts: FACT_KEYS.map((key): FactLookup => {
      const hit = facts.find((fact) => fact.key === key)
      return hit === undefined ? { found: false } : { found: true, value: hit.value }
    }),
    recalledFacts: PREFIXES.map((prefix) => facts.filter((fact) => fact.key.startsWith(prefix))),
    retries: RETRY_KEYS.map((key) => retries.find((retry) => retry.key === key)),
    recalledRetries: PREFIXES.map((prefix) =>
      retries.filter((retry) => retry.key.startsWith(prefix)),
    ),
    branches: REPOS.map((repo) => {
      const hit = ofType('branches-observed').findLast((event) => event.repo === repo)
      if (hit === undefined) return undefined
      return { repo, head: hit.head, branches: hit.branches, worktrees: hit.worktrees }
    }),
    workspace: workspaceRecordOf(events),
    lastUserSaidSeq: ofType('user-said').at(-1)?.seq ?? 0,
  }
}

const bookViewOf = (cache: RecordCache) => {
  const { head: _head, tails: _tails, ...view } = viewOf(cache)
  return view
}

describe('RecordCache incremental views', () => {
  for (const seed of [1, 7, 42, 1956, 20_000, 31_337]) {
    it(`match a fresh load after every random batch (seed ${seed})`, async () => {
      const pick = pickerOf(seed)
      const { plane, epoch } = await openThread()
      const cache = await RecordCache.load({ plane, threadId: THREAD })
      for (let batch = 0; batch < 40; batch += 1) {
        const bodies: V2Body[] = []
        const count = 1 + pick.int(5)
        for (let index = 0; index < count; index += 1) {
          bodies.push(bodyOf({ pick, headSeq: cache.currentHead().seq + index }))
        }
        await commit({ plane, epoch, cache, bodies })

        const fresh = await RecordCache.load({ plane, threadId: THREAD })
        expect(viewOf(cache)).toEqual(viewOf(fresh))
        expect(bookViewOf(cache)).toEqual(foldedViewOf(cache))
        for (const event of fresh.eventsAfter(0)) {
          expect(cache.committedHashAtSeq(event.seq)).toBe(chainHash(event))
        }
      }
    }, 30_000)
  }

  it('hands out loop events that later appends leave untouched', async () => {
    const { plane, epoch } = await openThread()
    const cache = await RecordCache.load({ plane, threadId: THREAD })
    await commit({ plane, epoch, cache, bodies: [{ type: 'user-said', text: 'first' }] })

    const before = cache.visibleLoopEvents()
    expect(cache.visibleLoopEvents()).toBe(before)
    await commit({ plane, epoch, cache, bodies: [{ type: 'user-said', text: 'second' }] })

    expect(before.map((event) => event.seq)).toEqual([1])
    expect(cache.visibleLoopEvents().map((event) => event.seq)).toEqual([1, 2])
  })
})
