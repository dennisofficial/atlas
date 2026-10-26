import { describe, expect, it } from 'bun:test'

import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { briefOfEvents, callsOfEvents } from '../agents-calls'

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'child',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-26T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const events: WireEvent[] = [
  wire(1, { type: 'user-said', text: 'Find the importers' }),
  wire(2, { type: 'tool-called', callId: 'c1', name: 'read', input: { path: 'a.ts' }, ordinal: 0 }),
  wire(3, { type: 'tool-result', callId: 'c1', name: 'read', output: 'x', modelText: '12 lines' }),
  wire(4, {
    type: 'tool-called',
    callId: 'c2',
    name: 'bash',
    input: { command: 'ls' },
    ordinal: 0,
  }),
]

describe('callsOfEvents', () => {
  it('lists the child thread tool calls in order with their state', () => {
    const calls = callsOfEvents(events)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      kind: EToolKind.Read,
      state: EToolState.Done,
      output: '12 lines',
    })
    expect(calls[1]).toMatchObject({ kind: EToolKind.Shell, state: EToolState.Running })
  })

  it('is empty for a thread that has made no calls', () => {
    expect(callsOfEvents([events[0]!])).toEqual([])
  })
})

describe('briefOfEvents', () => {
  it('reads the first operator message as the brief', () => {
    expect(briefOfEvents(events)).toBe('Find the importers')
  })

  it('is undefined without one', () => {
    expect(briefOfEvents([])).toBeUndefined()
  })
})
