import { describe, expect, it } from 'bun:test'

import {
  EMPTY_PENDING,
  ETurnCause,
  pendingInputsOf,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { mintEvents } from '../__tests__/support'
import { EOutgoingPlacement } from '../outgoing-messages'
import { optimisticPlacementOf } from '../optimistic-placement'

const staged = (placement: EOutgoingPlacement) => [{ clientId: 'client-a', placement }]

const posted = (inboxId: number): RecordEventBody => ({
  type: 'input-posted',
  inboxId,
  kind: 'message',
  postedAt: '2026-11-23T10:00:00.000Z',
  message: { text: 'ship it', clientId: 'client-a' },
})

const said = (inboxId: number): RecordEventBody => ({
  type: 'user-said',
  text: 'ship it',
  clientId: 'client-a',
  inboxId,
})

const started = (turnId: string): RecordEventBody => ({
  type: 'turn-started',
  turnId,
  cause: ETurnCause.Input,
})

const placement = (args: {
  placement: EOutgoingPlacement
  bodies?: readonly RecordEventBody[]
}): ReturnType<typeof optimisticPlacementOf> => {
  const events = mintEvents({ bodies: args.bodies ?? [] })
  return optimisticPlacementOf({
    staged: staged(args.placement),
    events,
    pending: pendingInputsOf(events),
  })
}

describe('optimisticPlacementOf', () => {
  it('keeps an idle send in the transcript before any event names it', () => {
    const placed = placement({ placement: EOutgoingPlacement.Transcript })

    expect(placed.transcript.map((entry) => entry.clientId)).toEqual(['client-a'])
    expect(placed.queue).toEqual([])
    expect(placed.hiddenInboxIds.size).toBe(0)
  })

  it('keeps an idle send landed once it is posted and hides the pending row until it is said', () => {
    const placed = placement({
      placement: EOutgoingPlacement.Transcript,
      bodies: [posted(4)],
    })

    expect(placed.transcript.map((entry) => entry.clientId)).toEqual(['client-a'])
    expect(placed.queue).toEqual([])
    expect([...placed.hiddenInboxIds]).toEqual([4])
  })

  it('hands an idle send over to the landed message and never yields a queued row', () => {
    const placed = placement({
      placement: EOutgoingPlacement.Transcript,
      bodies: [posted(4), said(4), started('turn-1')],
    })

    expect(placed.transcript).toEqual([])
    expect(placed.queue).toEqual([])
    expect(placed.hiddenInboxIds.size).toBe(0)
  })

  it('shows a send made while a turn is open as a queued row', () => {
    const placed = placement({ placement: EOutgoingPlacement.Queue })

    expect(placed.queue.map((entry) => entry.clientId)).toEqual(['client-a'])
    expect(placed.transcript).toEqual([])
  })

  it('drops the optimistic queued row once the pending row carries it', () => {
    const placed = placement({
      placement: EOutgoingPlacement.Queue,
      bodies: [started('turn-1'), posted(4)],
    })

    expect(placed.queue).toEqual([])
    expect(placed.transcript).toEqual([])
    expect(placed.hiddenInboxIds.size).toBe(0)
  })

  it('turns an idle send into the queued row when another turn already runs', () => {
    const placed = placement({
      placement: EOutgoingPlacement.Transcript,
      bodies: [started('turn-1'), posted(4)],
    })

    expect(placed.transcript).toEqual([])
    expect(placed.hiddenInboxIds.size).toBe(0)
  })

  it('leaves a withdrawn or refused send with nothing to show', () => {
    const withdrawn = placement({
      placement: EOutgoingPlacement.Transcript,
      bodies: [posted(4), { type: 'input-withdrawn', inboxId: 4 }],
    })
    const refused = placement({
      placement: EOutgoingPlacement.Queue,
      bodies: [{ type: 'input-refused', inboxId: 4, reason: 'unreadable', clientId: 'client-a' }],
    })

    expect(withdrawn.transcript).toEqual([])
    expect(withdrawn.queue).toEqual([])
    expect(refused.transcript).toEqual([])
    expect(refused.queue).toEqual([])
  })

  it('places each staged send where it was placed at send time', () => {
    const placed = optimisticPlacementOf({
      staged: [
        { clientId: 'client-a', placement: EOutgoingPlacement.Transcript },
        { clientId: 'client-b', placement: EOutgoingPlacement.Queue },
      ],
      events: [],
      pending: EMPTY_PENDING,
    })

    expect(placed.transcript.map((entry) => entry.clientId)).toEqual(['client-a'])
    expect(placed.queue.map((entry) => entry.clientId)).toEqual(['client-b'])
  })
})
