import type { V2Event } from '@dltech/atlas-core'
import { EAuthor, EEntryKind } from '@dltech/atlas-client/transcript'
import { describe, expect, it } from 'bun:test'

import { EOperatorRequestKind, EOperatorRequestOutcome } from '../../core/request'
import { operatorRequestEntries, requestEntriesAt } from '../request-entry'

const NOW = Date.now()
const SOON = new Date(NOW + 15 * 60_000).toISOString()
const PAST = new Date(NOW - 60_000).toISOString()
const PATH = '/atlas/sessions/s1/requests/req_1'

const stamp = (body: Record<string, unknown>, n: number): V2Event =>
  ({
    ...body,
    seq: n,
    at: `2026-11-12T11:5${n}:00.000Z`,
    threadId: 't1',
    id: `e${n}`,
  }) as unknown as V2Event

const asked = (n = 1, extra: Record<string, unknown> = {}): V2Event =>
  stamp(
    {
      type: 'operator-input-asked',
      requestId: 'req_1',
      kind: EOperatorRequestKind.Input,
      prompt: 'What is the login code?',
      secret: true,
      expiresAt: SOON,
      sessionId: 's1',
      ...extra,
    },
    n,
  )

const settled = (n = 2, extra: Record<string, unknown> = {}): V2Event =>
  stamp(
    {
      type: 'operator-input-settled',
      requestId: 'req_1',
      outcome: EOperatorRequestOutcome.Delivered,
      path: PATH,
      bytes: 7,
      sessionId: 's1',
      ...extra,
    },
    n,
  )

const entryOf = (events: readonly V2Event[]) => {
  const [entry] = [...requestEntriesAt({ events, now: NOW }).values()]
  if (entry === undefined) throw new Error('no operator request entry was built')
  return entry
}

describe('the operator request row', () => {
  it('reads an unanswered request before its deadline as pending', () => {
    expect(entryOf([asked()])).toEqual({
      kind: EEntryKind.OperatorRequest,
      author: EAuthor.Model,
      key: 'e1',
      text: 'asked the operator: What is the login code?',
      requestId: 'req_1',
      prompt: 'What is the login code?',
      secret: true,
      state: 'pending',
      expiresAt: SOON,
    })
  })

  it('pairs the settlement by requestId and keeps the id of the event that drew the card', () => {
    const entry = entryOf([asked(), settled()])

    expect(entry.key).toBe('e1')
    expect(entry.state).toBe('delivered')
    expect(entry.path).toBe(PATH)
    expect(entry.bytes).toBe(7)
    expect(entry.text).toBe(
      `asked the operator: What is the login code? — the operator delivered a value to ${PATH} (7 bytes)`,
    )
  })

  it('carries the shell a shell ask names', () => {
    const entry = entryOf([
      asked(1, { kind: EOperatorRequestKind.Shell, shellId: 'shell-9f2c1a04' }),
      settled(2, { path: undefined, bytes: undefined, shellId: undefined }),
    ])

    expect(entry.shellId).toBe('shell-9f2c1a04')
  })

  it('reads a cancelled settlement as cancelled', () => {
    const entry = entryOf([
      asked(),
      settled(2, {
        outcome: EOperatorRequestOutcome.Cancelled,
        path: undefined,
        bytes: undefined,
      }),
    ])

    expect(entry.state).toBe('cancelled')
    expect(entry.path).toBeUndefined()
    expect(entry.text).toContain('cancelled')
    expect(entry.text).toContain('no value arrived')
  })

  it('reads an abandoned settlement as abandoned and says the session stopped waiting', () => {
    const entry = entryOf([
      asked(),
      settled(2, {
        outcome: EOperatorRequestOutcome.Abandoned,
        path: undefined,
        bytes: undefined,
        reason: 'abandoned',
      }),
    ])

    expect(entry.state).toBe('abandoned')
    expect(entry.text).toContain('stopped waiting for the answer')
    expect(entry.text).not.toContain('cancelled')
  })

  it('reads an expired settlement as expired', () => {
    const entry = entryOf([
      asked(),
      settled(2, {
        outcome: EOperatorRequestOutcome.Expired,
        path: undefined,
        bytes: undefined,
      }),
    ])

    expect(entry.state).toBe('expired')
    expect(entry.text).toContain('expired')
  })

  it('reads a failed settlement as failed with its reason', () => {
    const entry = entryOf([
      asked(),
      settled(2, {
        outcome: EOperatorRequestOutcome.Failed,
        path: undefined,
        bytes: undefined,
        reason: 'the requests directory could not be created',
      }),
    ])

    expect(entry.state).toBe('failed')
    expect(entry.reason).toBe('the requests directory could not be created')
    expect(entry.text).toContain('the requests directory could not be created')
  })

  it('reads a deadline that passed with no settlement as expired', () => {
    const entry = entryOf([asked(1, { expiresAt: PAST })])

    expect(entry.state).toBe('expired')
    expect(entry.text).toContain('no value arrived')
  })

  it('leaves a card that looks live only while its deadline is ahead of the clock', () => {
    const live = operatorRequestEntries([asked()]).get('e1')
    const past = operatorRequestEntries([asked(1, { expiresAt: PAST })]).get('e1')

    expect(live?.text).toBe('asked the operator: What is the login code?')
    expect(past?.text).toContain('expired')
  })

  it('ignores a settlement whose request nobody asked for', () => {
    expect([...requestEntriesAt({ events: [settled()], now: NOW }).values()]).toEqual([])
  })

  it('keeps a request with no deadline pending until it settles', () => {
    const noDeadline = { ...JSON.parse(JSON.stringify(asked(1))) }
    delete noDeadline.expiresAt

    const open = requestEntriesAt({ events: [noDeadline as V2Event], now: NOW })
    expect(open.get('e1')?.state).toBe('pending')

    const closed = requestEntriesAt({
      events: [noDeadline as V2Event, settled(2)],
      now: NOW,
    })
    expect(closed.get('e1')?.state).toBe('delivered')
  })
})
