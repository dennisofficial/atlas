import { describe, expect, it } from 'bun:test'

import { toCallId } from '../../events/ids'
import { chainEvents } from '../../record/chain-events'
import type { RecordEventBody, RecordEvent } from '../../record/event'
import { NOW, runId, threadId, userSaid } from '../../record/__tests__/support'
import { EPlanStatus, PLAN_TOOL_NAME } from '../plan'
import { planView, type PlanViewState } from '../view'

const chain = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const wrote = (args: { callId: string; tasks: readonly unknown[] }): RecordEventBody => ({
  type: 'tool-called',
  callId: toCallId(args.callId),
  name: PLAN_TOOL_NAME,
  input: { tasks: args.tasks },
  ordinal: 0,
})

const settled = (args: {
  callId: string
  error?: { message: string }
  interrupted?: boolean
}): RecordEventBody => ({
  type: 'tool-result',
  callId: toCallId(args.callId),
  name: PLAN_TOOL_NAME,
  ...(args.error === undefined ? {} : { error: args.error }),
  ...(args.interrupted === undefined ? {} : { interrupted: args.interrupted }),
})

const denied = (callId: string): RecordEventBody => ({
  type: 'tool-denied',
  callId: toCallId(callId),
  name: PLAN_TOOL_NAME,
  reason: 'no',
})

const foldOf = (events: readonly RecordEvent[]): PlanViewState =>
  events.reduce(planView.fold, planView.initial)

const textsOf = (state: PlanViewState): string[] => state.tasks.map((task) => task.text)

describe('the plan view fold', () => {
  it('is the tasks of the call once its result lands', () => {
    const events = chain([
      userSaid('go'),
      wrote({ callId: 'call-1', tasks: [{ text: 'read the code' }] }),
      settled({ callId: 'call-1' }),
    ])

    expect(planView.fold(planView.initial, events[1] as RecordEvent)).toEqual({
      tasks: [],
      pending: { 'call-1': [{ ordinal: 1, text: 'read the code', status: EPlanStatus.Pending }] },
    })
    expect(foldOf(events)).toEqual({
      tasks: [{ ordinal: 1, text: 'read the code', status: EPlanStatus.Pending }],
      pending: {},
    })
  })

  it('derives ordinals from position and keeps active forms', () => {
    const state = foldOf(
      chain([
        wrote({
          callId: 'call-1',
          tasks: [
            { text: 'read', status: EPlanStatus.InProgress, activeForm: 'reading' },
            { text: 'write' },
          ],
        }),
        settled({ callId: 'call-1' }),
      ]),
    )

    expect(state.tasks).toEqual([
      { ordinal: 1, text: 'read', status: EPlanStatus.InProgress, activeForm: 'reading' },
      { ordinal: 2, text: 'write', status: EPlanStatus.Pending },
    ])
  })

  it('keeps the previous plan when the write failed, was interrupted or was denied', () => {
    const previous = chain([
      wrote({ callId: 'call-0', tasks: [{ text: 'first' }] }),
      settled({ callId: 'call-0' }),
    ])
    const [failed, interrupted, refused] = [
      chain([
        wrote({ callId: 'call-1', tasks: [{ text: 'second' }] }),
        settled({ callId: 'call-1', error: { message: 'no' } }),
      ]),
      chain([
        wrote({ callId: 'call-1', tasks: [{ text: 'second' }] }),
        settled({ callId: 'call-1', interrupted: true }),
      ]),
      chain([wrote({ callId: 'call-1', tasks: [{ text: 'second' }] }), denied('call-1')]),
    ]

    for (const events of [failed, interrupted, refused]) {
      expect(textsOf(foldOf([...previous, ...events]))).toEqual(['first'])
    }
  })

  it('lets the newest successful write win', () => {
    const state = foldOf(
      chain([
        wrote({ callId: 'call-1', tasks: [{ text: 'first' }] }),
        settled({ callId: 'call-1' }),
        wrote({ callId: 'call-2', tasks: [{ text: 'second' }, { text: 'third' }] }),
        settled({ callId: 'call-2' }),
      ]),
    )

    expect(textsOf(state)).toEqual(['second', 'third'])
  })

  it('ignores an input that does not parse', () => {
    const state = foldOf(
      chain([
        wrote({ callId: 'call-1', tasks: [{ text: 'first' }] }),
        settled({ callId: 'call-1' }),
        wrote({ callId: 'call-2', tasks: [{ ordinal: 1 }] }),
        settled({ callId: 'call-2' }),
      ]),
    )

    expect(textsOf(state)).toEqual(['first'])
  })

  it('treats an empty list as a plan that clears the previous one', () => {
    const state = foldOf(
      chain([
        wrote({ callId: 'call-1', tasks: [{ text: 'first' }] }),
        settled({ callId: 'call-1' }),
        wrote({ callId: 'call-2', tasks: [] }),
        settled({ callId: 'call-2' }),
      ]),
    )

    expect(state).toEqual({ tasks: [], pending: {} })
  })

  it('changes nothing for a result whose call it never saw', () => {
    const events = chain([
      wrote({ callId: 'call-1', tasks: [{ text: 'first' }] }),
      settled({ callId: 'call-1' }),
    ])
    const folded = foldOf(events)

    expect(planView.fold(folded, chain([settled({ callId: 'call-9' })])[0] as RecordEvent)).toBe(
      folded,
    )
  })

  it('folds in pages exactly as in one pass', () => {
    const events = chain([
      wrote({ callId: 'call-1', tasks: [{ text: 'first' }] }),
      settled({ callId: 'call-1' }),
      wrote({ callId: 'call-2', tasks: [{ text: 'second', status: EPlanStatus.Completed }] }),
      settled({ callId: 'call-2' }),
    ])
    const paged = events
      .slice(3)
      .reduce(planView.fold, events.slice(0, 3).reduce(planView.fold, planView.initial))

    expect(paged).toEqual(foldOf(events))
  })

  it('declares itself rewindable', () => {
    expect(planView.rewindable).toBe(true)
  })
})
