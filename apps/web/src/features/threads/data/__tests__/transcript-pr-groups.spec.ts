import { describe, expect, it } from 'bun:test'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import { durableTranscriptOf, ETranscriptKind, transcriptViewOf } from '../transcript-items'

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-22T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const comment = (args: { seq: number; prNumber?: number; repo?: string }) =>
  wire(args.seq, {
    type: 'pr-event',
    repo: args.repo ?? 'github.com/owner/repo',
    prNumber: args.prNumber ?? 42,
    kind: 'comment',
    url: 'https://github.com/owner/repo/pull/42',
    authorLogin: 'bot',
    body: `comment ${args.seq}`,
  })

const itemsOf = (events: WireEvent[]) =>
  transcriptViewOf({
    durable: durableTranscriptOf({ events: eventsFromWire(events) }),
    live: [],
  }).items

describe('consecutive pr-event notices in the transcript', () => {
  it('collapses a burst for one PR into a single row keyed by the first event', () => {
    const items = itemsOf([comment({ seq: 1 }), comment({ seq: 2 }), comment({ seq: 3 })])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: ETranscriptKind.Notice,
      id: 'evt_1',
      title: 'PR #42: 3 updates',
    })
  })

  it('leaves a lone pr-event as its own row', () => {
    const items = itemsOf([comment({ seq: 1 })])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'evt_1',
      title: 'PR #42: bot commented — comment 1',
    })
  })

  it('splits the run when another kind of entry sits between the events', () => {
    const items = itemsOf([
      comment({ seq: 1 }),
      comment({ seq: 2 }),
      wire(3, { type: 'user-said', text: 'hold on' }),
      comment({ seq: 4 }),
      comment({ seq: 5 }),
    ])

    expect(items.map((item) => item.kind)).toEqual([
      ETranscriptKind.Notice,
      ETranscriptKind.User,
      ETranscriptKind.Notice,
    ])
    expect(items.map((item) => item.id)).toEqual(['evt_1', 'evt_3', 'evt_4'])
  })

  it('splits the run when the pull request changes', () => {
    const items = itemsOf([
      comment({ seq: 1 }),
      comment({ seq: 2 }),
      comment({ seq: 3, prNumber: 43 }),
      comment({ seq: 4, prNumber: 43 }),
      comment({ seq: 5, repo: 'github.com/other/repo', prNumber: 43 }),
    ])

    expect(items.map((item) => item.id)).toEqual(['evt_1', 'evt_3', 'evt_5'])
    expect(items[0]).toMatchObject({ title: 'PR #42: 2 updates' })
    expect(items[1]).toMatchObject({ title: 'PR #43: 2 updates' })
    expect(items[2]).toMatchObject({
      title: 'PR #43: bot commented — comment 5',
    })
  })
})
