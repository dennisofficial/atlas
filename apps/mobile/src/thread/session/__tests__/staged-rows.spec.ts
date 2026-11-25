import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'

import { EMessageAuthor, ERowKind } from '../../rows'
import { eventSchema } from '../registered-plugins'
import { stagedRowsOf } from '../rows'

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
  events: (args.events ?? []).map((event) => eventSchema.parse(event)),
  foldable: (args.events ?? []).map((event) => eventSchema.parse(event)),
  quickStops: [],
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

const STAGED = [{ clientId: 'client-a', text: 'first', attachments: [] }]

describe('stagedRowsOf', () => {
  it('puts a staged message at the end of the transcript while the agent is idle', () => {
    const rows = stagedRowsOf({ snapshot: snapshotOf({}), staged: STAGED, now: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe(ERowKind.Message)
    expect(rows[0]?.id).toBe('client-a')
    expect(rows[0]?.kind === ERowKind.Message ? rows[0].author : undefined).toBe(EMessageAuthor.You)
    expect(rows[0]?.kind === ERowKind.Message ? rows[0].staged : undefined).toBe(true)
  })

  it('shows the attachments of a staged message', () => {
    const media = {
      id: `media:${'a'.repeat(64)}`,
      name: 'shot.png',
      mediaType: 'image/png',
      size: 4,
      content: { store: 'media' as const, hash: 'a'.repeat(64) },
    }
    const rows = stagedRowsOf({
      snapshot: snapshotOf({}),
      staged: [{ clientId: 'client-a', text: '', attachments: [media] }],
      now: 0,
    })
    expect(rows[0]?.kind === ERowKind.Message ? rows[0].attachments : []).toEqual([media])
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
