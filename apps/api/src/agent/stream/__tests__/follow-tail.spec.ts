import { chainHash, ETurnCause, SESSION_VIEW_VERSION, type RecordEvent } from '@dltech/atlas-core'
import {
  EStreamResetReason,
  STREAM_TAIL_EVENTS,
  STREAM_TOO_FAR_BEHIND_EVENTS,
} from '@dltech/atlas-protocol'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { FollowRig, SESSION, said, THREAD } from './follow-rig'

const HEAD = STREAM_TOO_FAR_BEHIND_EVENTS + 100
const TAIL_FROM = HEAD - STREAM_TAIL_EVENTS + 1

const hashAtOf = async (args: {
  rig: FollowRig
  threadId?: string
  seq: number
}): Promise<string> => {
  const page = await args.rig.plane.readEvents({
    threadId: args.threadId ?? THREAD,
    afterSeq: args.seq - 1,
    limit: 1,
    visible: false,
  })
  const event: RecordEvent | undefined = page.events[0]
  if (event === undefined) throw new Error(`no event ${args.seq}`)
  return chainHash(event)
}

const longLogOf = async (rig: FollowRig): Promise<void> => {
  await rig.seed({ events: 0 })
  await rig.append([{ type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }])
  await rig.append(Array.from({ length: HEAD - 1 }, (_, n) => said(`m${n}`)))
}

describe('follow tail open', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  it('opens a cold, far-behind follow at the base and pages the tail to live', async () => {
    await longLogOf(rig)
    await rig.subscribe({ session: rig.open(), tailViewVersion: SESSION_VIEW_VERSION })
    await rig.untilSeq(HEAD)
    await rig.settled()

    const bases = rig.frames('base')
    expect(bases).toHaveLength(1)
    expect(bases[0]?.cursor.seq).toBe(TAIL_FROM - 1)
    expect(bases[0]?.view.at).toBe(HEAD)
    expect(bases[0]?.durable.map((event) => event.type)).toEqual(['turn-started'])
    expect(bases[0]?.commandLog).toEqual([])
    expect(rig.seqs()[0]).toBe(TAIL_FROM)
    expect(rig.seqs().at(-1)).toBe(HEAD)
    expect(rig.frames('events').at(-1)?.live).toBe(true)
    expect(rig.tailBaseReads).toBe(1)
    const catchups = rig.analytics.eventsOf('session_catchup')
    expect(catchups).toHaveLength(1)
    expect(catchups[0]?.properties?.start).toBe('tail')
    expect(catchups[0]?.properties?.tail_missed).toBe(false)
    expect(catchups[0]?.properties?.events).toBe(STREAM_TAIL_EVENTS)
  })

  it('marks the catch-up when an opted-in cold open finds no tail base and replays the log', async () => {
    await longLogOf(rig)
    rig.tailBaseMissing = true
    await rig.subscribe({ session: rig.open(), tailViewVersion: SESSION_VIEW_VERSION })
    await rig.untilSeq(HEAD)
    await rig.settled()

    expect(rig.frames('base')).toHaveLength(0)
    expect(rig.seqs()[0]).toBe(1)
    const catchups = rig.analytics.eventsOf('session_catchup')
    expect(catchups[0]?.properties?.start).toBe('cold')
    expect(catchups[0]?.properties?.tail_missed).toBe(true)
    expect(catchups[0]?.properties?.events).toBe(HEAD)
  })

  it('replays the whole log when the client does not opt in', async () => {
    await longLogOf(rig)
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(HEAD)
    await rig.settled()

    expect(rig.frames('base')).toHaveLength(0)
    expect(rig.seqs()[0]).toBe(1)
    expect(rig.tailBaseReads).toBe(0)
  })

  it('replays the whole log when the client view version differs', async () => {
    await longLogOf(rig)
    await rig.subscribe({
      session: rig.open(),
      tailViewVersion: SESSION_VIEW_VERSION - 1,
    })
    await rig.untilSeq(HEAD)
    await rig.settled()

    expect(rig.frames('base')).toHaveLength(0)
    expect(rig.seqs()[0]).toBe(1)
    expect(rig.tailBaseReads).toBe(0)
  })

  it('resets a warm cursor that is too far behind and then sends the base', async () => {
    await longLogOf(rig)
    const afterSeq = 50
    await rig.subscribe({
      session: rig.open(),
      afterSeq,
      afterHash: await hashAtOf({ rig, seq: afterSeq }),
      tailViewVersion: SESSION_VIEW_VERSION,
    })
    await rig.untilSeq(HEAD)
    await rig.settled()

    const resets = rig.frames('reset')
    expect(resets).toHaveLength(1)
    expect(resets[0]?.reason).toBe(EStreamResetReason.TooFarBehind)
    expect(resets[0]?.tailFrom).toBe(TAIL_FROM)
    expect(rig.frames('base')[0]?.cursor.seq).toBe(TAIL_FROM - 1)
    expect(rig.seqs()[0]).toBe(TAIL_FROM)
  })

  it('resumes a warm cursor that is close enough without a base', async () => {
    await longLogOf(rig)
    const afterSeq = HEAD - 100
    await rig.subscribe({
      session: rig.open(),
      afterSeq,
      afterHash: await hashAtOf({ rig, seq: afterSeq }),
      tailViewVersion: SESSION_VIEW_VERSION,
    })
    await rig.untilSeq(HEAD)
    await rig.settled()

    expect(rig.frames('reset')).toHaveLength(0)
    expect(rig.frames('base')).toHaveLength(0)
    expect(rig.seqs()[0]).toBe(afterSeq + 1)
    expect(rig.tailBaseReads).toBe(0)
  })

  it('never sends a base for a thread that is not the main one', async () => {
    await rig.seed({ events: 0 })
    const threadId = 'thread-2'
    await rig.plane.createThread({ threadId, sessionId: SESSION })
    await rig.appendTo({
      threadId,
      bodies: Array.from({ length: HEAD }, (_, n) => said(`t${n}`)),
    })
    await rig.subscribe({ session: rig.open(), threadId, tailViewVersion: SESSION_VIEW_VERSION })
    await rig.untilSeq(HEAD)
    await rig.settled()

    expect(rig.frames('base')).toHaveLength(0)
    expect(rig.seqs()[0]).toBe(1)
    expect(rig.tailBaseReads).toBe(0)
  })

  it('opens a cold, opted-in follow at the tail when the head is one past the tail size', async () => {
    await rig.seed({ events: STREAM_TAIL_EVENTS + 1 })
    await rig.subscribe({ session: rig.open(), tailViewVersion: SESSION_VIEW_VERSION })
    await rig.untilSeq(STREAM_TAIL_EVENTS + 1)
    await rig.settled()

    const bases = rig.frames('base')
    expect(bases).toHaveLength(1)
    expect(bases[0]?.cursor.seq).toBe(1)
    expect(rig.seqs()).toHaveLength(STREAM_TAIL_EVENTS)
    expect(rig.seqs()[0]).toBe(2)
    expect(rig.seqs().at(-1)).toBe(STREAM_TAIL_EVENTS + 1)
    expect(rig.frames('events').at(-1)?.live).toBe(true)
    expect(rig.tailBaseReads).toBe(1)
  })

  it('replays the whole log when a cold head is exactly the tail size', async () => {
    await rig.seed({ events: STREAM_TAIL_EVENTS })
    await rig.subscribe({ session: rig.open(), tailViewVersion: SESSION_VIEW_VERSION })
    await rig.untilSeq(STREAM_TAIL_EVENTS)
    await rig.settled()

    expect(rig.frames('base')).toHaveLength(0)
    expect(rig.seqs()[0]).toBe(1)
    expect(rig.seqs()).toHaveLength(STREAM_TAIL_EVENTS)
    expect(rig.tailBaseReads).toBe(0)
  })

  it('resumes a warm cursor 1,200 behind inside the too-far-behind window', async () => {
    await longLogOf(rig)
    const afterSeq = HEAD - 1_200
    await rig.subscribe({
      session: rig.open(),
      afterSeq,
      afterHash: await hashAtOf({ rig, seq: afterSeq }),
      tailViewVersion: SESSION_VIEW_VERSION,
    })
    await rig.untilSeq(HEAD)
    await rig.settled()

    expect(HEAD - afterSeq).toBe(1_200)
    expect(rig.frames('reset')).toHaveLength(0)
    expect(rig.frames('base')).toHaveLength(0)
    expect(rig.seqs()[0]).toBe(afterSeq + 1)
    expect(rig.tailBaseReads).toBe(0)
  })
})
