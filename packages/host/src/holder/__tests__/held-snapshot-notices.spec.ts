import { describe, expect, it } from 'bun:test'

import {
  EHeldAction,
  EServiceStatus,
  inboxEventPayloadOf,
  type InboxEntry,
} from '@dltech/atlas-core'

import { eventsOf, snapshotOf } from './held-snapshot-fixture'

const inboxServiceEndedOf = (args: {
  inboxId: number
  kind?: string
  restarting?: true
}): InboxEntry => ({
  sessionId: 'session-1',
  inboxId: args.inboxId,
  kind: args.kind ?? 'event',
  payload: inboxEventPayloadOf({
    event: {
      type: 'service-ended',
      serviceId: 'svc-1',
      command: 'bun dev',
      status: EServiceStatus.Exited,
      tail: '',
      ...(args.restarting === true ? { restarting: true } : {}),
    },
  }),
  postedAt: '2026-11-12T03:00:00.000Z',
  consumedSeq: null,
  threadId: null,
  senderSessionId: null,
})

describe('readHeldAction over a notice that does not take a turn', () => {
  it('waits for a restarting service ending instead of starting an empty turn', async () => {
    const snapshot = await snapshotOf({
      events: eventsOf([]),
      inbox: [inboxServiceEndedOf({ inboxId: 8, restarting: true })],
    })
    expect(snapshot.action).toBe(EHeldAction.Wait)
  })

  it('holds the pod past the idle deadline for it', async () => {
    const snapshot = await snapshotOf({
      events: eventsOf([]),
      inbox: [inboxServiceEndedOf({ inboxId: 8, restarting: true })],
    })
    expect(snapshot.action).not.toBe(EHeldAction.Release)
  })

  it('waits for a record entry even when the event it carries would take a turn', async () => {
    const snapshot = await snapshotOf({
      events: eventsOf([]),
      inbox: [inboxServiceEndedOf({ inboxId: 9, kind: 'record' })],
    })
    expect(snapshot.action).toBe(EHeldAction.Wait)
  })

  it('starts a turn for a service ending that is not a restart', async () => {
    const snapshot = await snapshotOf({
      events: eventsOf([]),
      inbox: [inboxServiceEndedOf({ inboxId: 8 })],
    })
    expect(snapshot.action).toBe(EHeldAction.StartTurn)
  })
})
