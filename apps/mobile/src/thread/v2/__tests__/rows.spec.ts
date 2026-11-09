import { describe, expect, it } from 'bun:test'

import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'

import { EMessageAuthor, ERowKind } from '../../rows'
import { v2EventSchema } from '../registered-plugins'
import { v2ViewOf } from '../rows'

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
  events: raw.map((event) => v2EventSchema.parse(event)),
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

describe('v2ViewOf', () => {
  it('turns a page into message rows in order', () => {
    const rows = v2ViewOf({ snapshot: snapshotOf([said, answered]), now: NOW }).rows
    expect(rows.map((row) => row.kind)).toEqual([ERowKind.Message, ERowKind.Message])
    expect(rows.map((row) => (row.kind === ERowKind.Message ? row.author : null))).toEqual([
      EMessageAuthor.You,
      EMessageAuthor.Atlas,
    ])
  })

  it('renders the rest of a page whose plugin body carries no row', () => {
    const ready = { ...envelope(2), type: 'service-ready', serviceId: 'svc-1' }
    const rows = v2ViewOf({ snapshot: snapshotOf([said, ready]), now: NOW }).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe(ERowKind.Message)
  })

  it('stays empty for an empty snapshot', () => {
    expect(v2ViewOf({ snapshot: snapshotOf([]), now: NOW }).rows).toEqual([])
  })
})
