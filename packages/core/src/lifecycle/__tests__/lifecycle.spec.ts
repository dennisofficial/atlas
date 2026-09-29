import { describe, expect, it } from 'bun:test'

import type { Event, EventEnvelope } from '../../events/envelope'
import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { ELifecycleState, endedKeysOf, lifecycleOf, lostOf, type LifecycleKind } from '../lifecycle'

const threadId = toThreadId('thread-lifecycle')

type FakeStart = Event & { type: 'fake-started'; name: string; scope?: string }
type FakeEnd = Event & { type: 'fake-ended'; name: string; scope?: string }

let sequence = 0
const envelope = (): EventEnvelope => {
  sequence += 1
  return {
    id: toEventId(`event-${sequence}`),
    seq: sequence,
    threadId,
    runId: toRunId('run-1'),
    depth: 0,
    at: '2026-01-01T00:00:00.000Z',
  }
}

const started = (name: string, scope?: string): FakeStart =>
  ({ type: 'fake-started', name, ...(scope === undefined ? {} : { scope }), ...envelope() }) as FakeStart

const ended = (name: string, scope?: string): FakeEnd =>
  ({ type: 'fake-ended', name, ...(scope === undefined ? {} : { scope }), ...envelope() }) as FakeEnd

const fakeKind: LifecycleKind<FakeStart, FakeEnd> = {
  isStart: (event): event is FakeStart => event.type === ('fake-started' as never),
  isEnd: (event): event is FakeEnd => event.type === ('fake-ended' as never),
  keyOf: (event) => event.name,
  scopeOf: (event) => event.scope ?? '',
}

describe('lifecycleOf', () => {
  it('marks an opened-and-closed thing settled', () => {
    const lifecycles = lifecycleOf([started('a', 's1'), ended('a', 's1')], fakeKind)
    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Settled)
  })

  it('marks an open with no close lost', () => {
    expect(lifecycleOf([started('a', 's1')], fakeKind)[0]?.state).toBe(ELifecycleState.Lost)
  })

  it('never lets a recycled id in a new scope settle a start from an old scope', () => {
    const lifecycles = lifecycleOf(
      [started('a', 's1'), started('a', 's2'), ended('a', 's2')],
      fakeKind,
    )
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Lost)
    expect(lifecycles[1]?.state).toBe(ELifecycleState.Settled)
  })

  it('pairs FIFO within one scope when an id is reused', () => {
    const lifecycles = lifecycleOf(
      [started('a', 's1'), started('a', 's1'), ended('a', 's1')],
      fakeKind,
    )
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Settled)
    expect(lifecycles[1]?.state).toBe(ELifecycleState.Lost)
  })

  it('ignores a close with no matching open', () => {
    expect(lifecycleOf([ended('ghost', 's1')], fakeKind)).toHaveLength(0)
  })
})

describe('the projections', () => {
  it('lostOf returns only the unsettled opens', () => {
    const events = [started('a', 's1'), started('b', 's1'), ended('a', 's1')]
    expect(lostOf(events, fakeKind).map((lifecycle) => lifecycle.key)).toEqual(['b'])
  })

  it('endedKeysOf names the scoped key of every recorded close', () => {
    const events = [started('a', 's1'), ended('a', 's1'), ended('a', 's2')]
    expect([...endedKeysOf(events, fakeKind)].sort()).toEqual(['s1a', 's2a'])
  })
})
