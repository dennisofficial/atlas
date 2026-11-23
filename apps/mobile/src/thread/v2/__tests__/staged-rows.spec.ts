import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'

import { EMessageAuthor, ERowKind } from '../../rows'
import { v2EventSchema } from '../registered-plugins'
import { stagedQueueRowsOf, stagedRowsOf } from '../rows'

const envelope = (seq: number) => ({
  id: `evt_${seq}`,
  seq,
  threadId: 'thr_1',
  runId: 'run_1',
  depth: 0,
  at: `2026-11-08T20:00:0${seq}.000Z`,
  epoch: 0,
  prevHash: '0'.repeat(64),
})

const snapshotOf = (args: { events?: readonly unknown[]; working?: boolean }): SessionSnapshot => ({
  events: (args.events ?? []).map((event) => v2EventSchema.parse(event)),
  foldable: (args.events ?? []).map((event) => v2EventSchema.parse(event)),
  pending: { pending: [] },
  cursor: undefined,
  status:
    args.working === true
      ? { state: ESessionStatus.Thinking, lease: { epoch: 1, holderHostId: 1, live: true } }
      : undefined,
  overlay: undefined,
  shells: {},
  connection: ESessionConnection.Live,
  error: undefined,
  skipped: 0,
  writerAhead: false,
  fromCache: false,
})

const STAGED = [{ clientId: 'client-a', text: 'first' }]

describe('stagedRowsOf', () => {
  it('puts a staged message at the end of the transcript while the agent is idle', () => {
    const rows = stagedRowsOf({ snapshot: snapshotOf({}), staged: STAGED, now: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe(ERowKind.Message)
    expect(rows[0]?.id).toBe('client-a')
    expect(rows[0]?.kind === ERowKind.Message ? rows[0].author : undefined).toBe(EMessageAuthor.You)
    expect(rows[0]?.kind === ERowKind.Message ? rows[0].staged : undefined).toBe(true)
  })

  it('puts a staged message in the dock, not the transcript, while a turn is open', () => {
    const rows = stagedRowsOf({
      snapshot: snapshotOf({ working: true }),
      staged: STAGED,
      now: 0,
    })
    expect(rows).toEqual([])
  })

  it('drops a staged message once the log carries it', () => {
    const rows = stagedRowsOf({
      snapshot: snapshotOf({
        events: [{ ...envelope(1), type: 'user-said', text: 'first', clientId: 'client-a' }],
      }),
      staged: STAGED,
      now: 0,
    })
    expect(rows).toEqual([])
  })
})

describe('stagedQueueRowsOf', () => {
  it('exposes the queue placement while a turn is open', () => {
    const rows = stagedQueueRowsOf({
      snapshot: snapshotOf({ working: true }),
      staged: STAGED,
      now: 0,
    })
    expect(rows.map((row) => row.id)).toEqual(['client-a'])
    expect(rows[0]?.kind === ERowKind.Message ? rows[0].staged : undefined).toBe(true)
  })

  it('is empty when the agent is idle and the row belongs to the transcript', () => {
    expect(stagedQueueRowsOf({ snapshot: snapshotOf({}), staged: STAGED, now: 0 })).toEqual([])
  })
})
