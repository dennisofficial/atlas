import { describe, expect, it } from 'bun:test'

import type { RecordEvent } from '@dltech/atlas-core'

import {
  EOutgoingPlacement,
  EStagedOutcome,
  pendingStagedOf,
  placementOf,
  restorableStagedOf,
  stagedOutcomesOf,
  stagedPlacementOf,
} from '../outgoing-messages'

type PartialEvent = { type: string } & Record<string, unknown>

const eventsOf = (partials: readonly PartialEvent[]): RecordEvent[] =>
  partials.map(
    (partial, index) =>
      ({
        id: `event-${index}`,
        seq: index + 1,
        threadId: 'thread',
        runId: 'run',
        depth: 0,
        at: '2026-11-18T00:00:00.000Z',
        epoch: 0,
        prevHash: 'a'.repeat(64),
        ...partial,
      }) as unknown as RecordEvent,
  )

const STAGED = [
  { clientId: 'client-a', text: 'first' },
  { clientId: 'client-b', text: 'second' },
]

describe('placementOf', () => {
  it('puts a staged message in the queue while a turn is open and at the transcript end when idle', () => {
    expect(placementOf({ working: true })).toBe(EOutgoingPlacement.Queue)
    expect(placementOf({ working: false })).toBe(EOutgoingPlacement.Transcript)
  })
})

describe('stagedOutcomesOf', () => {
  it('treats a staged clientId as pending until an event names it', () => {
    const outcomes = stagedOutcomesOf({ events: [], clientIds: ['client-a'] })
    expect(outcomes.size).toBe(0)
  })

  it('removes a staged message on input-posted, user-said, input-refused and input-withdrawn', () => {
    const cases: readonly PartialEvent[] = [
      {
        type: 'input-posted',
        inboxId: 1,
        kind: 'message',
        postedAt: 'now',
        message: { text: 'first', clientId: 'client-a' },
      },
      { type: 'user-said', text: 'first', clientId: 'client-a', inboxId: 1 },
      { type: 'input-refused', inboxId: 1, reason: 'unreadable', clientId: 'client-a' },
      { type: 'input-withdrawn', inboxId: 1 },
    ]
    const expected = [
      EStagedOutcome.Posted,
      EStagedOutcome.Posted,
      EStagedOutcome.Refused,
      EStagedOutcome.Withdrawn,
    ]
    cases.forEach((partial, index) => {
      const posted =
        partial.type === 'input-withdrawn'
          ? eventsOf([
              {
                type: 'input-posted',
                inboxId: 1,
                kind: 'message',
                postedAt: 'now',
                message: { text: 'first', clientId: 'client-a' },
              },
            ])
          : eventsOf([])
      const outcomes = stagedOutcomesOf({
        events: [...posted, ...eventsOf([partial])],
        clientIds: ['client-a', 'client-b'],
      })
      expect(outcomes.get('client-a')?.outcome).toBe(expected[index] as EStagedOutcome)
      expect(outcomes.has('client-b')).toBe(false)
    })
  })

  it('removes the staged message a withdraw refused because it was already sent', () => {
    const outcomes = stagedOutcomesOf({
      events: eventsOf([
        {
          type: 'input-posted',
          inboxId: 7,
          kind: 'message',
          postedAt: 'now',
          message: { text: 'first', clientId: 'client-a' },
        },
        { type: 'input-refused', inboxId: 8, targetInboxId: 7, reason: 'already-sent' },
      ]),
      clientIds: ['client-a'],
    })
    expect(outcomes.get('client-a')?.outcome).toBe(EStagedOutcome.Refused)
    expect(outcomes.get('client-a')?.reason).toBe('already-sent')
  })

  it('settles a staged message as discarded when the stop beat it', () => {
    const outcomes = stagedOutcomesOf({
      events: eventsOf([
        {
          type: 'input-posted',
          inboxId: 1,
          kind: 'message',
          postedAt: 'now',
          message: { text: 'first', clientId: 'client-a' },
        },
        { type: 'input-consumed', inboxId: 1, consumed: 'discarded' },
      ]),
      clientIds: ['client-a'],
    })

    expect(outcomes.get('client-a')?.outcome).toBe(EStagedOutcome.Discarded)
  })

  it('keeps a message that the turn consumed posted', () => {
    const outcomes = stagedOutcomesOf({
      events: eventsOf([
        {
          type: 'input-posted',
          inboxId: 1,
          kind: 'message',
          postedAt: 'now',
          message: { text: 'first', clientId: 'client-a' },
        },
        { type: 'input-consumed', inboxId: 1, consumed: 'message' },
      ]),
      clientIds: ['client-a'],
    })

    expect(outcomes.get('client-a')?.outcome).toBe(EStagedOutcome.Posted)
  })

  it('offers a discarded copy back with no reason and no longer counts it as pending', () => {
    const events = eventsOf([
      {
        type: 'input-posted',
        inboxId: 1,
        kind: 'message',
        postedAt: 'now',
        message: { text: 'first', clientId: 'client-a' },
      },
      { type: 'input-consumed', inboxId: 1, consumed: 'discarded' },
    ])
    const entry = { clientId: 'client-a', text: 'first' }
    const staged = [entry]

    expect(restorableStagedOf({ staged, events })).toEqual([{ staged: entry, reason: undefined }])
    expect(pendingStagedOf({ staged, events })).toEqual([])
  })

  it('keeps a staged message pending while only other clientIds reach the log', () => {
    const outcomes = stagedOutcomesOf({
      events: eventsOf([
        {
          type: 'input-posted',
          inboxId: 3,
          kind: 'message',
          postedAt: 'now',
          message: { text: 'second', clientId: 'client-b' },
        },
      ]),
      clientIds: ['client-a'],
    })
    expect(outcomes.has('client-a')).toBe(false)
  })
})

describe('pendingStagedOf', () => {
  it('drops every staged message the log has settled and keeps the rest in order', () => {
    const events = eventsOf([
      {
        type: 'input-posted',
        inboxId: 1,
        kind: 'message',
        postedAt: 'now',
        message: { text: 'first', clientId: 'client-a' },
      },
    ])
    expect(pendingStagedOf({ staged: STAGED, events }).map((entry) => entry.clientId)).toEqual([
      'client-b',
    ])
  })
})

describe('stagedPlacementOf', () => {
  it('renders pending staged messages in the queue while the agent is working', () => {
    const split = stagedPlacementOf({ staged: STAGED, events: [], working: true })
    expect(split.queue.map((entry) => entry.clientId)).toEqual(['client-a', 'client-b'])
    expect(split.transcript).toEqual([])
  })

  it('renders pending staged messages at the end of the transcript while the agent is idle', () => {
    const split = stagedPlacementOf({ staged: STAGED, events: [], working: false })
    expect(split.transcript.map((entry) => entry.clientId)).toEqual(['client-a', 'client-b'])
    expect(split.queue).toEqual([])
  })

  it('moves a staged message from the transcript to the queue when a turn opens', () => {
    const idle = stagedPlacementOf({ staged: STAGED, events: [], working: false })
    const working = stagedPlacementOf({ staged: STAGED, events: [], working: true })
    expect(idle.transcript.length).toBe(2)
    expect(working.queue.length).toBe(2)
  })

  it('leaves a settled message out of both spots', () => {
    const events = eventsOf([
      { type: 'user-said', text: 'first', clientId: 'client-a', inboxId: 1 },
    ])
    const split = stagedPlacementOf({ staged: STAGED, events, working: false })
    expect(split.transcript.map((entry) => entry.clientId)).toEqual(['client-b'])
  })
})

describe('restorableStagedOf', () => {
  it('returns the text of a refused staged message with its reason', () => {
    const events = eventsOf([
      {
        type: 'input-refused',
        inboxId: 1,
        reason: 'attachment unreadable',
        clientId: 'client-a',
        message: { text: 'first' },
      },
    ])
    const restorable = restorableStagedOf({
      staged: [{ clientId: 'client-a', text: 'first' }],
      events,
    })
    expect(restorable).toHaveLength(1)
    expect(restorable[0]?.reason).toBe('attachment unreadable')
    expect(stagedOutcomesOf({ events, clientIds: ['client-a'] }).get('client-a')?.text).toBe(
      'first',
    )
  })

  it('returns the text of a withdrawn message and nothing for a posted one', () => {
    const events = eventsOf([
      {
        type: 'input-posted',
        inboxId: 1,
        kind: 'message',
        postedAt: 'now',
        message: { text: 'first', clientId: 'client-a' },
      },
      { type: 'input-withdrawn', inboxId: 1 },
    ])
    const restorable = restorableStagedOf({
      staged: [
        { clientId: 'client-a', text: 'first' },
        { clientId: 'client-b', text: 'second' },
      ],
      events,
    })
    expect(restorable.map((entry) => entry.staged.clientId)).toEqual(['client-a'])
  })
})
