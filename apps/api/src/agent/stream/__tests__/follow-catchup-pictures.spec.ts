import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { toCallId, type RecordEvent, type RecordEventBody } from '@dltech/atlas-core'

import { FollowRig, said, THREAD } from './follow-rig'

describe('follow catch-up with pictures', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  it('withholds a legacy inline picture instead of sending its bytes', async () => {
    await rig.seed({ events: 3 })
    await rig.append([
      {
        type: 'tool-result',
        callId: toCallId('call-1'),
        name: 'read',
        output: {},
        modelParts: [
          {
            type: 'image',
            bytes: { kind: 'inline', data: 'A'.repeat(3_400_000) },
            mediaType: 'image/png',
            width: 8,
            height: 6,
          },
        ],
      },
    ])
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(4)

    const frames = rig.frames('events')
    const events = frames.flatMap((frame) => frame.events) as unknown as readonly RecordEvent[]
    const pictures: unknown[] = []
    for (const event of events)
      if (event.type === 'tool-result') pictures.push(...(event.modelParts ?? []))

    expect(pictures).toEqual([
      { type: 'image', bytes: { kind: 'withheld' }, mediaType: 'image/png', width: 8, height: 6 },
    ])
    expect(Buffer.byteLength(JSON.stringify(frames), 'utf8')).toBeLessThan(64 * 1024)
  })

  it('catches a log of multi-megabyte pictures up in one page', async () => {
    await rig.seed({ events: 0 })
    const bodies: RecordEventBody[] = []
    for (let n = 0; n < 40; n += 1) {
      if (n % 2 === 0) bodies.push(said(`m${n}`))
      else
        bodies.push({
          type: 'tool-result',
          callId: toCallId(`call-${n}`),
          name: 'read',
          output: {},
          modelParts: [
            {
              type: 'image',
              bytes: { kind: 'inline', data: 'A'.repeat(3_000_000) },
              mediaType: 'image/png',
            },
          ],
        })
    }
    await rig.append(bodies)
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(40)
    await rig.settled()

    expect(rig.frames('events').length).toBeLessThanOrEqual(2)
    expect(rig.frames('events').at(-1)?.live).toBe(true)
    expect(rig.reads).toBeLessThanOrEqual(2)
  })

  it('reports the stored page cursor so a reconnect after a withheld page does not fork', async () => {
    await rig.seed({ events: 199 })
    await rig.append([
      {
        type: 'tool-result',
        callId: toCallId('call-1'),
        name: 'read',
        output: {},
        modelParts: [
          {
            type: 'image',
            bytes: { kind: 'inline', data: 'A'.repeat(3_400_000) },
            mediaType: 'image/png',
            width: 8,
            height: 6,
          },
        ],
      },
      said('after the picture'),
    ])
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(201)
    await rig.settled()

    const stored = await rig.plane.readEvents({
      threadId: THREAD,
      afterSeq: 199,
      limit: 1,
      visible: false,
    })
    const holding = rig.frames('events').find((frame) => Number(frame.events.at(-1)?.seq) === 200)
    expect(holding?.live).toBe(false)
    expect(holding?.cursor).toEqual({ seq: 200, hash: rig.hashAt(stored.events, 200) })

    const hash = holding?.cursor?.hash
    if (hash === undefined) throw new Error('no page cursor')
    await rig.subscribe({ session: rig.open(), id: 'sub-2', afterSeq: 200, afterHash: hash })
    await rig.untilSeq(201)
    expect(rig.frames('reset')).toHaveLength(0)
  })
})
