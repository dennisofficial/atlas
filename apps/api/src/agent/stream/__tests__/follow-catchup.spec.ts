import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { FOLLOW_TAIL_BYTES } from '../follow-limits'
import { FollowRig, said } from './follow-rig'

const PAGE_READ = 2

describe('follow catch-up', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  it('delivers a rewind appended between pages of the first catch-up', async () => {
    await rig.seed({ events: 250 })
    let appended = false
    rig.onRead = async () => {
      if (appended || rig.reads !== PAGE_READ) return
      appended = true
      await rig.append([{ type: 'history-rewound', toSeq: 100 }, said('after rewind')])
    }
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(252)
    const seqs = rig.seqs()
    expect(seqs).toContain(251)
    expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b))
  })

  it('bounds the cold tail by bytes and keeps the newest events', async () => {
    await rig.seed({ events: 0 })
    const text = 'x'.repeat(2_048)
    for (let batch = 0; batch < 10; batch += 1) {
      await rig.append(Array.from({ length: 100 }, () => said(text)))
    }
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(1_000)
    const events = rig.frames('events').flatMap((frame) => frame.events)
    const bytes = events.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)), 0)
    expect(bytes).toBeLessThanOrEqual(FOLLOW_TAIL_BYTES + 4_096)
    expect(events.at(-1)?.seq).toBe(1_000)
    expect(events[0]?.seq).toBeGreaterThan(1)
  })

  it('never calls a page live when the head it reports is ahead of it', async () => {
    await rig.seed({ events: 3 })
    let appended = false
    rig.onRead = async () => {
      if (appended || rig.reads !== PAGE_READ) return
      appended = true
      await rig.append([said('raced')])
    }
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(4)
    for (const frame of rig.frames('events')) {
      if (!frame.live) continue
      expect(Number(frame.events.at(-1)?.seq ?? 0)).toBeGreaterThanOrEqual(frame.head.seq)
    }
    expect(rig.frames('events').at(-1)?.live).toBe(true)
  })
})
