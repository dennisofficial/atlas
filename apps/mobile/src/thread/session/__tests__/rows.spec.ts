import { describe, expect, it } from 'bun:test'

import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'
import { ESessionStatus } from '@dltech/atlas-core'

import { EMessageAuthor, ERowKind, type ThreadRow } from '../../rows'
import { eventSchema } from '../registered-plugins'
import { modelOf, viewOf } from '../rows'

const NOW = Date.parse('2026-11-08T20:00:10.000Z')

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

const snapshotOf = (raw: readonly unknown[]): SessionSnapshot => ({
  events: raw.map((event) => eventSchema.parse(event)),
  foldable: raw.map((event) => eventSchema.parse(event)),
  quickStops: [],
  pending: { pending: [] },
  cursor: undefined,
  status: undefined,
  overlay: undefined,
  shells: {},
  connection: ESessionConnection.Live,
  error: undefined,
  skipped: 0,
  writerAhead: false,
  fromCache: false,
})

const said = { ...envelope(1), type: 'user-said', text: 'hello there' }

const answered = {
  ...envelope(2),
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'on it' }],
}

const parked = {
  ...envelope(3),
  type: 'tool-parked',
  callId: 'call_1',
  name: 'operator_input',
  request: { kind: 'input', prompt: 'Paste the login code' },
}

const requestAnswered = {
  ...envelope(4),
  type: 'tool-result',
  callId: 'call_1',
  name: 'operator_input',
  output: { outcome: 'delivered', path: '/x', bytes: 4 },
}

const viewAt = (args: {
  snapshot: SessionSnapshot
  now?: number
  previous?: readonly ThreadRow[]
}) =>
  viewOf({
    model: modelOf({ snapshot: args.snapshot }),
    snapshot: args.snapshot,
    now: args.now ?? NOW,
    previous: args.previous,
  })

describe('viewOf', () => {
  it('keeps the session busy but opens no turn while a command such as summarise runs', () => {
    const snapshot: SessionSnapshot = {
      ...snapshotOf([said, answered]),
      status: {
        state: ESessionStatus.RunningCommand,
        reason: 'summarise',
        since: '2026-11-08T20:00:05.000Z',
        lease: { epoch: 1, holderHostId: 1, live: true },
      },
    }
    const view = viewAt({ snapshot })
    expect({ working: view.working, turnRunning: view.turnRunning }).toEqual({
      working: true,
      turnRunning: false,
    })
  })

  it('turns a page into message rows in order', () => {
    const rows = viewAt({ snapshot: snapshotOf([said, answered]) }).rows
    expect(rows.map((row) => row.kind)).toEqual([ERowKind.Message, ERowKind.Message])
    expect(rows.map((row) => (row.kind === ERowKind.Message ? row.author : null))).toEqual([
      EMessageAuthor.You,
      EMessageAuthor.Atlas,
    ])
  })

  it('renders the rest of a page whose plugin body carries no row', () => {
    const ready = { ...envelope(2), type: 'service-ready', serviceId: 'svc-1' }
    const rows = viewAt({ snapshot: snapshotOf([said, ready]) }).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe(ERowKind.Message)
  })

  it('draws no transcript row for a request that is still parked', () => {
    expect(viewAt({ snapshot: snapshotOf([parked]) }).rows).toEqual([])
  })

  it('draws the operator answer as a notice row once the call settles', () => {
    const rows = viewAt({ snapshot: snapshotOf([parked, requestAnswered]) }).rows

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: ERowKind.Notice,
      title: 'The operator answered',
      body: 'Paste the login code',
    })
  })

  it('stays empty for an empty snapshot', () => {
    expect(viewAt({ snapshot: snapshotOf([]) }).rows).toEqual([])
  })
})

describe('viewOf across a clock tick', () => {
  it('keeps every row when only the clock moved', () => {
    const snapshot = snapshotOf([said, answered])
    const model = modelOf({ snapshot })
    const first = viewOf({ model, snapshot, now: NOW })

    const ticked = viewOf({ model, snapshot, now: NOW + 1_000, previous: first.rows })

    expect(ticked.rows).toBe(first.rows)
  })

  it('holds the identity of a row that a new event left untouched', () => {
    const first = viewAt({ snapshot: snapshotOf([said]) })
    const grown = snapshotOf([said, answered])

    const next = viewAt({ snapshot: grown, now: NOW + 1_000, previous: first.rows })

    expect(next.rows).toHaveLength(2)
    expect(next.rows[0]).toBe(first.rows[0])
    expect(next.rows[1]).not.toBe(first.rows[0])
  })

  it('takes the new row when its text moved', () => {
    const first = viewAt({ snapshot: snapshotOf([said]) })
    const corrected = snapshotOf([{ ...said, text: 'hello again' }])

    const next = viewAt({ snapshot: corrected, now: NOW + 1_000, previous: first.rows })

    expect(next.rows[0]).not.toBe(first.rows[0])
  })
})
