import { describe, expect, it } from 'bun:test'

import { BOOT_STEP_EVENT_TYPE, type WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire, unreadableWireCount } from '../events-from-wire'

const wireRow = (overrides: Partial<WireEvent>): WireEvent => ({
  id: 'evt-1',
  seq: 1,
  threadId: 'thread-1',
  runId: 'run-1',
  depth: 0,
  at: '2026-11-08T20:00:00.000Z',
  type: 'user-said',
  body: JSON.stringify({ type: 'user-said', text: 'hello' }),
  ...overrides,
})

describe('unreadableWireCount', () => {
  it('is zero for an empty page', () => {
    expect(unreadableWireCount([])).toBe(0)
  })

  it('is zero when every row parses', () => {
    expect(unreadableWireCount([wireRow({})])).toBe(0)
  })

  it('counts rows whose body no installed schema accepts', () => {
    const newer = wireRow({
      id: 'evt-2',
      seq: 2,
      type: 'from-the-future',
      body: JSON.stringify({ type: 'from-the-future' }),
    })
    const broken = wireRow({ id: 'evt-3', seq: 3, body: '{' })
    const wire = [wireRow({}), newer, broken]
    expect(unreadableWireCount(wire)).toBe(2)
    expect(eventsFromWire(wire)).toHaveLength(1)
  })

  it('ignores boot step rows, which are dropped on purpose', () => {
    const boot = wireRow({ type: BOOT_STEP_EVENT_TYPE, body: '{}' })
    expect(unreadableWireCount([boot])).toBe(0)
  })
})
