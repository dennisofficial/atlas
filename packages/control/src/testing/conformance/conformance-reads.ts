import { beforeEach, describe, expect, it } from 'bun:test'
import {
  chainHash,
  ECompactionAnchor,
  toCallId,
  visibleEvents,
  withholdPictureBytes,
  type RecordEventBody,
} from '@dltech/atlas-core'

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

    it('projects inline pictures out of a page without touching the stored log', async () => {
      const picture = {
        type: 'image',
        bytes: { kind: 'inline', data: 'A'.repeat(4_096) },
        mediaType: 'image/png',
      } as const
      const { events } = await appendBodies({
        harness,
        epoch,
        bodies: [
          said('before'),
          { type: 'tool-result', callId: toCallId('call-1'), name: 'read', modelParts: [picture] },
          said('after'),
        ],
      })
      const stored = await harness.plane.readEvents({
        threadId: THREAD,
        afterSeq: 0,
        limit: 10,
        visible: false,
      })
      const withheld = await harness.plane.readEvents({
        threadId: THREAD,
        afterSeq: 0,
        limit: 10,
        visible: false,
        withholdPictures: true,
      })

      expect(stored.events).toEqual(events)
      expect(withheld.events).toEqual(events.map((event) => withholdPictureBytes(event)))
      const tail = events[events.length - 1]
      if (tail === undefined) throw new Error('no appended event')
      expect(withheld.lastHash).toBe(chainHash(tail))
      expect(stored.lastHash).toBe(chainHash(tail))
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
  })
}
