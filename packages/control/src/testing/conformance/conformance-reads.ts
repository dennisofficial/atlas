import { beforeEach, describe, expect, it } from 'bun:test'
import {
  canonicalJson,
  chainHash,
  ECompactionAnchor,
  visibleEvents,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { readEventsIn } from '../../read-events'

import type { ConformanceParams } from './conformance'
import {
  appendBodies,
  makeHarness,
  readAll,
  said,
  seedGranted,
  THREAD,
  type Harness,
} from './support'

export function describeControlPlaneReads(
  params: Pick<ConformanceParams, 'name' | 'makeStore' | 'reset'>,
): void {
  describe(`ControlPlane visible reads (${params.name})`, () => {
    let harness: Harness
    let epoch: number

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      epoch = await seedGranted(harness)
    })

    it('visible reads equal core visibleEvents after rewind and summary', async () => {
      const bodies: RecordEventBody[] = Array.from({ length: 8 }, (_, i) => said(`m${i}`))
      bodies.push({ type: 'permission-revoked', grantId: 'g1' })
      bodies.push({
        type: 'history-summarised',
        fromSeq: 2,
        throughSeq: 6,
        anchor: ECompactionAnchor.Prefix,
        summary: 's',
      })
      bodies.push(said('after'))
      bodies.push({ type: 'history-rewound', toSeq: 9 })
      bodies.push(said('tail'))
      const { events } = await appendBodies({ harness, epoch, bodies })
      expect(await readAll({ harness, visible: true })).toEqual(visibleEvents(events))
      expect(await readAll({ harness, visible: true, limit: 2 })).toEqual(visibleEvents(events))
      expect(await readAll({ harness, visible: false })).toEqual(events)
    })

    it('visible reads with hidden types add only those types from hidden ranges', async () => {
      const fact = (key: string): RecordEventBody => ({
        type: 'fact-recorded',
        key,
        kind: 'fact',
      })
      const bodies: RecordEventBody[] = [said('m0'), fact('f1'), said('m2'), fact('f3'), said('m4')]
      bodies.push({ type: 'permission-revoked', grantId: 'g1' })
      bodies.push({
        type: 'history-summarised',
        fromSeq: 1,
        throughSeq: 5,
        anchor: ECompactionAnchor.Prefix,
        summary: 's',
      })
      bodies.push(said('after'), fact('f9'), said('gone'))
      bodies.push({ type: 'history-rewound', toSeq: 8 })
      bodies.push(said('tail'))
      const { events } = await appendBodies({ harness, epoch, bodies })
      const visibleSeqs = new Set(visibleEvents(events).map((event) => event.seq))
      const expected = events.filter(
        (event) => visibleSeqs.has(event.seq) || event.type === 'fact-recorded',
      )
      const hiddenTypes = ['fact-recorded'] as const
      expect(await readAll({ harness, visible: true, hiddenTypes })).toEqual(expected)
      expect(await readAll({ harness, visible: true, hiddenTypes, limit: 2 })).toEqual(expected)
    })

    it('reads only exact stored cursors with the same hash as a decoded event', async () => {
      const { events } = await appendBodies({
        harness,
        epoch,
        bodies: [said('漢😀'.repeat(5_000)), said('next')],
      })
      for (const event of events) {
        expect(await harness.plane.readEventCursor({ threadId: THREAD, seq: event.seq })).toEqual({
          seq: event.seq,
          hash: chainHash(event),
        })
      }
      for (const seq of [0, -1, 3]) {
        expect(await harness.plane.readEventCursor({ threadId: THREAD, seq })).toBeUndefined()
      }
      expect(await harness.plane.readEventCursor({ threadId: 'missing', seq: 1 })).toBeUndefined()
    })

    it('byte-bounded pages match the original algorithm across sparse visible segments', async () => {
      const { events } = await appendBodies({
        harness,
        epoch,
        bodies: [
          said('oversized'.repeat(2_000)),
          said('漢😀'.repeat(200)),
          { type: 'fact-recorded', key: 'k', kind: 'note' },
          said('hidden'),
          {
            type: 'history-summarised',
            fromSeq: 2,
            throughSeq: 4,
            anchor: ECompactionAnchor.Prefix,
            summary: 's',
          },
          said('visible'),
          { type: 'history-rewound', toSeq: 5 },
          said('tail'),
        ],
      })
      const store = params.makeStore()
      const firstSize = Buffer.byteLength(canonicalJson(events[0]))
      for (const maxBytes of [0, 1, firstSize - 1, firstSize, firstSize + 500, 1_000_000]) {
        for (const limit of [1, 3, 100]) {
          for (const visible of [false, true]) {
            for (const onlyTypes of [
              undefined,
              ['user-said'] as const,
              ['fact-recorded'] as const,
            ]) {
              let afterSeq = 0
              for (let guard = 0; guard < events.length + 1; guard += 1) {
                const read = { threadId: THREAD, afterSeq, limit, visible, maxBytes, onlyTypes }
                const expected = await store.transact(async (tx) => {
                  const row = await tx.readThread(THREAD)
                  if (row === undefined) throw new Error('missing thread')
                  const legacy = new Proxy(tx, {
                    get: (target, key) =>
                      key === 'readEventsByBytes' ? undefined : Reflect.get(target, key),
                  })
                  return readEventsIn({ tx: legacy, row, ...read })
                })
                const page = await harness.plane.readEvents(read)
                expect(page).toEqual(expected)
                if (page.next === undefined) break
                afterSeq = page.next
              }
            }
          }
        }
      }
    })

    it('extends a byte-bounded input-posted prefix to its commit boundary', async () => {
      const { events } = await appendBodies({
        harness,
        epoch,
        bodies: [
          {
            type: 'input-posted',
            inboxId: 1,
            kind: 'message',
            postedAt: '2026-11-02T12:00:00.000Z',
            text: '漢😀',
          },
          {
            type: 'input-posted',
            inboxId: 2,
            kind: 'message',
            postedAt: '2026-11-02T12:00:00.000Z',
            text: 'next',
          },
          said('commit'),
          said('next page'),
        ],
      })
      const page = await harness.plane.readEvents({
        threadId: THREAD,
        afterSeq: 0,
        limit: 100,
        visible: false,
        maxBytes: 1,
      })
      expect(page).toEqual({ events: events.slice(0, 3), next: 3, lastHash: chainHash(events[2]!) })
    })

    it('reads only the asked event types', async () => {
      const fact: RecordEventBody = { type: 'fact-recorded', key: 'k', kind: 'note' }
      const { events } = await appendBodies({
        harness,
        epoch,
        bodies: [said('first'), fact, said('second')],
      })
      const page = await harness.plane.readEvents({
        threadId: THREAD,
        afterSeq: 0,
        limit: 100,
        visible: true,
        onlyTypes: ['user-said'],
      })
      expect(page.events).toEqual(events.filter((event) => event.type === 'user-said'))
    })
  })
}
