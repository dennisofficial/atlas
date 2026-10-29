import { describe, expect, it } from 'bun:test'

import { EStepStatus } from '@dltech/atlas-ui/ai/plan'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import { planStepsOf } from '../composer-plan'

const said = (args: { seq: number; body: Record<string, unknown> }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T22:49:00.000Z',
  type: String(args.body.type),
  body: JSON.stringify(args.body),
})

const planEvents = (tasks: unknown[]): WireEvent[] => [
  said({
    seq: 1,
    body: {
      type: 'tool-called',
      callId: 'call_1',
      name: 'task_write',
      input: { tasks },
      ordinal: 0,
    },
  }),
  said({
    seq: 2,
    body: { type: 'tool-result', callId: 'call_1', name: 'task_write' },
  }),
]

describe('planStepsOf', () => {
  it('maps plan statuses onto step statuses with ordinal ids', () => {
    const events = eventsFromWire(
      planEvents([
        { text: 'Read the spec', status: 'completed' },
        {
          text: 'Write the code',
          activeForm: 'Writing the code',
          status: 'in_progress',
        },
        { text: 'Ship it' },
      ]),
    )
    expect(planStepsOf(events)).toEqual([
      { id: '1', title: 'Read the spec', status: EStepStatus.Done },
      { id: '2', title: 'Writing the code', status: EStepStatus.Running },
      { id: '3', title: 'Ship it', status: EStepStatus.Pending },
    ])
  })

  it('is empty when no plan was written', () => {
    expect(planStepsOf([])).toEqual([])
  })
})
