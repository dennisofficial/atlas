import { describe, expect, it } from 'bun:test'

import {
  ECompactionAnchor,
  ESessionStatus,
  toEventId,
  toRunId,
  toThreadId,
  type Hash,
  type RecordEvent,
} from '@dltech/atlas-core'
import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import {
  acceptedCommandOf,
  failedCommandOf,
  requestedCommandDone,
  requestedCommandOf,
  shownBlockingOf,
} from '../requested-command'
import type { SessionSnapshot } from '../session-follower'

type Status = NonNullable<SessionSnapshot['status']>

const REQUESTED = Date.parse('2026-11-28T10:00:00.000Z')
const CONSUMED = '2026-11-28T10:00:02.000Z'
const INBOX = 105
const SUMMARISING = { label: 'Summarising history', queued: 'Waits for the summary' }

const statusWith = (commands: readonly SessionCommandRow[]): Status => ({
  state: commands.length === 0 ? ESessionStatus.Idle : ESessionStatus.RunningCommand,
  reason: 'summarise',
  since: CONSUMED,
  lease: { epoch: 1, holderHostId: 1, live: true },
  ...(commands.length === 0 ? {} : { commands: [...commands] }),
})

const row = (state: ECommandState, inboxId = INBOX): SessionCommandRow => ({
  inboxId,
  name: 'summarise',
  postedAt: CONSUMED,
  state,
})

const summarised = (inboxId: number): RecordEvent => ({
  id: toEventId('t:20'),
  seq: 20,
  threadId: toThreadId('t'),
  runId: toRunId('r'),
  depth: 0,
  at: CONSUMED,
  epoch: 1,
  prevHash: 'a'.repeat(64) as Hash,
  type: 'history-summarised',
  fromSeq: 1,
  throughSeq: 4,
  anchor: ECompactionAnchor.Prefix,
  summary: 's',
  inboxId,
})

const requested = requestedCommandOf({ name: 'summarise', now: REQUESTED })
const accepted = { ...requested, inboxId: INBOX }

describe('shownBlockingOf', () => {
  it('shows a summarise the moment it is requested, before the server answers', () => {
    expect(shownBlockingOf({ requested, status: statusWith([]) })).toEqual({
      inboxId: undefined,
      name: 'summarise',
      startedAt: new Date(REQUESTED).toISOString(),
      copy: SUMMARISING,
    })
  })

  it('keeps the clock from the request once the server runs it', () => {
    const shown = shownBlockingOf({
      requested: accepted,
      status: statusWith([row(ECommandState.Running)]),
    })
    expect(shown?.inboxId).toBe(INBOX)
    expect(shown?.startedAt).toBe(new Date(REQUESTED).toISOString())
  })

  it('leaves a summarise queued behind a turn to the queued row', () => {
    const status = statusWith([row(ECommandState.Queued)])
    expect(shownBlockingOf({ requested: accepted, status })).toBeUndefined()
  })

  it('shows another running command as the server reports it', () => {
    const status = statusWith([row(ECommandState.Running, 99)])
    expect(shownBlockingOf({ requested: accepted, status })?.inboxId).toBe(99)
  })

  it('shows nothing for a command with no blocking copy', () => {
    const rename = requestedCommandOf({ name: 'rename', now: REQUESTED })
    expect(shownBlockingOf({ requested: rename, status: statusWith([]) })).toBeUndefined()
  })
})

describe('requestedCommandDone', () => {
  it('is not done while the request is in flight', () => {
    expect(
      requestedCommandDone({ requested, status: statusWith([]), events: [summarised(INBOX)] }),
    ).toBe(false)
  })

  it('is not done while the server lists it', () => {
    const status = statusWith([row(ECommandState.Running)])
    expect(requestedCommandDone({ requested: accepted, status, events: [] })).toBe(false)
  })

  it('is not done before its outcome lands', () => {
    expect(requestedCommandDone({ requested: accepted, status: statusWith([]), events: [] })).toBe(
      false,
    )
  })

  it('is done once its outcome lands', () => {
    expect(
      requestedCommandDone({
        requested: accepted,
        status: statusWith([]),
        events: [summarised(INBOX)],
      }),
    ).toBe(true)
  })

  it('ignores the outcome of another command', () => {
    expect(
      requestedCommandDone({
        requested: accepted,
        status: statusWith([]),
        events: [summarised(99)],
      }),
    ).toBe(false)
  })
})

describe('request transitions', () => {
  it('records the inbox id on the request it answers', () => {
    expect(acceptedCommandOf({ current: requested, requested, inboxId: INBOX })).toEqual(accepted)
  })

  it('leaves a newer request alone', () => {
    const newer = requestedCommandOf({ name: 'summarise', now: REQUESTED + 1 })
    expect(acceptedCommandOf({ current: newer, requested, inboxId: INBOX })).toBe(newer)
    expect(failedCommandOf({ current: newer, requested })).toBe(newer)
  })

  it('drops a request that failed', () => {
    expect(failedCommandOf({ current: requested, requested })).toBeUndefined()
  })
})
