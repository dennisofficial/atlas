import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EStepEndReason } from '@dltech/atlas-core'
import {
  EStreamBlockKind,
  EStreamClearReason,
  type LiveFrame,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { FOLLOW_HIGH_WATER_BYTES } from '../follow-limits'
import { STATUS_COALESCE_MS } from '../status-views'
import { FakeLiveSource } from './fake-live-source'
import { FollowRig, SESSION } from './follow-rig'

const KEY: StreamStepKey = { runId: 'run-1', step: 0, attempt: 0 }

const delta = (args: {
  from: number
  text: string
  block?: string
  key?: StreamStepKey
  kind?: EStreamBlockKind
}): LiveFrame => ({
  type: 'delta',
  key: args.key ?? KEY,
  block: args.block ?? 'b1',
  kind: args.kind ?? EStreamBlockKind.Text,
  from: args.from,
  text: args.text,
})

class ClientOverlay {
  blocks = new Map<string, string>()
  key: StreamStepKey | undefined
  gaps = 0

  apply(message: StreamServerMessage): void {
    if (message.type === 'overlay') {
      this.key = message.key
      this.blocks = new Map(message.blocks.map((block) => [block.block, block.text]))
      return
    }
    if (message.type === 'overlay-clear') {
      this.key = undefined
      this.blocks.clear()
      return
    }
    if (message.type !== 'delta') return
    const have = this.blocks.get(message.block) ?? ''
    if (message.from !== have.length) this.gaps += 1
    this.blocks.set(message.block, have + message.text)
  }
}

describe('live overlay', () => {
  let live: FakeLiveSource
  let rig: FollowRig

  beforeEach(async () => {
    live = new FakeLiveSource()
    rig = new FollowRig({ live })
    await rig.seed({ events: 1 })
  })

  afterEach(() => {
    rig.dispose()
  })

  const publish = (frame: LiveFrame): void => live.publish({ sessionId: SESSION, frame })
  const overlayMessages = () =>
    rig.sent.filter((m) => ['overlay', 'delta', 'overlay-clear', 'frame'].includes(m.type))
  const client = (): ClientOverlay => {
    const view = new ClientOverlay()
    for (const message of rig.sent) view.apply(message)
    return view
  }

  it('sends the text so far to a subscriber joining mid-step, then forwards deltas', async () => {
    publish({ type: 'step-start', key: KEY })
    publish(delta({ from: 0, text: 'Hello' }))
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    publish(delta({ from: 5, text: ', world' }))
    await rig.settled()
    expect(overlayMessages()).toEqual([
      {
        type: 'overlay',
        id: 'sub-1',
        key: KEY,
        blocks: [{ block: 'b1', kind: EStreamBlockKind.Text, text: 'Hello' }],
      },
      {
        type: 'delta',
        id: 'sub-1',
        key: KEY,
        block: 'b1',
        kind: EStreamBlockKind.Text,
        from: 5,
        text: ', world',
      },
    ])
  })

  it('sends nothing for a session with no step in flight', async () => {
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(overlayMessages()).toEqual([])
  })

  it('a publisher racing the join yields the producer text with no gap and no duplicate', async () => {
    const producer: LiveFrame[] = [{ type: 'step-start', key: KEY }]
    const texts = ['The ', 'quick ', 'brown ', 'fox ', 'jumps ', 'over ', 'the ', 'dog']
    const thoughts = ['hm', 'mm', ' ok']
    const offsets = { b1: 0, r1: 0 }
    for (let n = 0; n < texts.length; n += 1) {
      const text = texts[n] as string
      producer.push(delta({ from: offsets.b1, text }))
      offsets.b1 += text.length
      const thought = thoughts[n]
      if (thought === undefined) continue
      producer.push(
        delta({ from: offsets.r1, text: thought, block: 'r1', kind: EStreamBlockKind.Reasoning }),
      )
      offsets.r1 += thought.length
    }
    for (let joinAt = 0; joinAt <= producer.length; joinAt += 1) {
      for (let duringRead = 0; joinAt + duringRead <= producer.length; duringRead += 1) {
        const local = new FakeLiveSource()
        const localRig = new FollowRig({ live: local })
        await localRig.seed({ events: 1 })
        for (const frame of producer.slice(0, joinAt)) local.publish({ sessionId: SESSION, frame })
        local.afterCapture = () => {
          local.afterCapture = undefined
          for (const frame of producer.slice(joinAt, joinAt + duringRead)) {
            local.publish({ sessionId: SESSION, frame })
          }
        }
        await localRig.subscribe({ session: localRig.open() })
        await localRig.settled()
        for (const frame of producer.slice(joinAt + duringRead)) {
          local.publish({ sessionId: SESSION, frame })
        }
        await localRig.settled()
        const view = new ClientOverlay()
        for (const message of localRig.sent) view.apply(message)
        localRig.dispose()
        expect({ joinAt, duringRead, gaps: view.gaps }).toEqual({ joinAt, duringRead, gaps: 0 })
        expect(view.blocks.get('b1')).toBe(texts.join(''))
        expect(view.blocks.get('r1')).toBe(thoughts.join(''))
      }
    }
  }, 60_000)

  it('re-snapshots on a delta gap after a dropped publish', async () => {
    publish({ type: 'step-start', key: KEY })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    live.publish({ sessionId: SESSION, frame: delta({ from: 0, text: 'abc' }), deliver: false })
    publish(delta({ from: 3, text: 'def' }))
    await rig.settled()
    expect(rig.frames('overlay').at(-1)?.blocks).toEqual([
      { block: 'b1', kind: EStreamBlockKind.Text, text: 'abcdef' },
    ])
    expect(client().blocks.get('b1')).toBe('abcdef')
    expect(client().gaps).toBe(0)
  })

  it('trims an overlapping delta to the part the client lacks', async () => {
    publish({ type: 'step-start', key: KEY })
    publish(delta({ from: 0, text: 'abc' }))
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    publish(delta({ from: 1, text: 'bcde' }))
    publish(delta({ from: 0, text: 'ab' }))
    await rig.settled()
    expect(rig.frames('delta').map((m) => [m.from, m.text])).toEqual([[3, 'de']])
  })

  it('clears with lost when the buffer is gone under an open step', async () => {
    publish({ type: 'step-start', key: KEY })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    live.buffers.delete(SESSION)
    publish(delta({ from: 5, text: 'late' }))
    await rig.settled()
    expect(rig.frames('overlay-clear')).toEqual([
      { type: 'overlay-clear', id: 'sub-1', reason: EStreamClearReason.Lost },
    ])
    publish(delta({ from: 9, text: 'later' }))
    await rig.settled()
    expect(rig.frames('overlay-clear')).toHaveLength(1)
    expect(rig.frames('delta')).toEqual([])
  })

  it('forwards step-end as a frame and drops deltas of the ended step', async () => {
    publish({ type: 'step-start', key: KEY })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    publish({ type: 'step-end', key: KEY, reason: EStepEndReason.Finished })
    publish(delta({ from: 0, text: 'stale' }))
    publish({ type: 'step-start', key: KEY })
    await rig.settled()
    expect(rig.frames('frame').map((m) => m.frame.type)).toEqual(['step-end'])
    expect(rig.frames('delta')).toEqual([])
    expect(rig.frames('overlay')).toHaveLength(1)
  })

  it('moves to a later step and retires the earlier run', async () => {
    publish({ type: 'step-start', key: KEY })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    const next = { runId: 'run-2', step: 0, attempt: 0 }
    publish({ type: 'step-start', key: next })
    live.deliverRaw({
      sessionId: SESSION,
      raw: JSON.stringify(delta({ from: 0, text: 'old', key: { ...KEY, step: 3 } })),
    })
    publish(delta({ from: 0, text: 'new', key: next }))
    await rig.settled()
    expect(rig.frames('overlay').map((m) => m.key)).toEqual([KEY, next])
    expect(rig.frames('delta').map((m) => m.text)).toEqual(['new'])
  })

  it('forwards other live frames untouched', async () => {
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    publish({ type: 'tool-output', callId: 'call-1', text: 'out' })
    await rig.settled()
    expect(rig.frames('frame')).toEqual([
      { type: 'frame', id: 'sub-1', frame: { type: 'tool-output', callId: 'call-1', text: 'out' } },
    ])
  })

  it('drops a malformed frame', async () => {
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    live.deliverRaw({ sessionId: SESSION, raw: '{"type":"delta"}' })
    live.deliverRaw({ sessionId: SESSION, raw: 'not json' })
    await rig.settled()
    expect(overlayMessages()).toEqual([])
  })

  it('resends the overlay on resnap and on a source gap', async () => {
    publish({ type: 'step-start', key: KEY })
    publish(delta({ from: 0, text: 'abc' }))
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.settled()
    await session.handle({ type: 'resnap', id: 'sub-1' })
    await rig.settled()
    live.gap()
    await rig.settled()
    expect(rig.frames('overlay').map((m) => m.blocks[0]?.text)).toEqual(['abc', 'abc', 'abc'])
  })

  it('clears with holder-lost when the status view loses its holder', async () => {
    rig.store.markHostPresent(1)
    publish({ type: 'step-start', key: KEY })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    rig.store.markHostAbsent(1)
    await rig.plane.wake({ sessionIds: [SESSION] })
    rig.timers.advance(STATUS_COALESCE_MS)
    await rig.settled()
    expect(rig.frames('overlay-clear')).toEqual([
      { type: 'overlay-clear', id: 'sub-1', reason: EStreamClearReason.HolderLost },
    ])
  })

  it('drops deltas while the socket is backed up, then sends one overlay', async () => {
    publish({ type: 'step-start', key: KEY })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    rig.buffered = FOLLOW_HIGH_WATER_BYTES
    publish(delta({ from: 0, text: 'abc' }))
    publish(delta({ from: 3, text: 'def' }))
    await rig.settled()
    expect(rig.frames('delta')).toEqual([])
    rig.buffered = 0
    publish(delta({ from: 6, text: 'ghi' }))
    await rig.settled()
    expect(rig.frames('delta')).toEqual([])
    expect(rig.frames('overlay').at(-1)?.blocks[0]?.text).toBe('abcdefghi')
  })

  it('stops reading frames for a session once its last subscriber leaves', async () => {
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.settled()
    expect(live.subscribed.has(SESSION)).toBe(true)
    await session.handle({ type: 'unsubscribe', id: 'sub-1' })
    await rig.settled()
    expect(live.subscribed.has(SESSION)).toBe(false)
  })
})
