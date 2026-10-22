import { describe, expect, it } from 'bun:test'

import type { ChannelSignal } from '../../channel/signal'
import { EServeFrame } from '../channel-wire'

import { readied, recorder, THREAD } from './remote-channel-fixture'

const working = (value: boolean): ChannelSignal => ({ type: 'turn-working', working: value })

const reconnect = (attached: ReturnType<typeof readied>) => {
  attached.drop()
  attached.retries[0]?.run()
  attached.open()
}

describe('a Ready frame reconciling the working state for subscribers', () => {
  it('tells a subscriber that was busy when the socket dropped that the turn is gone', () => {
    const attached = readied()
    const { seen, listener } = recorder()
    attached.channel.subscribe({ threadId: THREAD, listener })
    attached.receive({ kind: EServeFrame.Signal, seq: 2, signal: working(true) })

    reconnect(attached)
    attached.receive({ kind: EServeFrame.Reload, sinceEventSeq: 0 })
    attached.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: false })

    expect(seen).toEqual([working(true), working(false)])
    expect(attached.channel.snapshot({ threadId: THREAD })).toEqual([])
  })

  it('sends a subscriber nothing when the first Ready finds the channel idle', () => {
    const attached = readied()
    const { seen, listener } = recorder()
    attached.channel.subscribe({ threadId: THREAD, listener })

    reconnect(attached)
    attached.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: false })

    expect(seen).toEqual([])
  })

  it('does not repeat a busy signal the subscriber already holds', () => {
    const attached = readied()
    const { seen, listener } = recorder()
    attached.channel.subscribe({ threadId: THREAD, listener })
    attached.receive({ kind: EServeFrame.Signal, seq: 2, signal: working(true) })

    reconnect(attached)
    attached.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: true })

    expect(seen).toEqual([working(true)])
  })

  it('tells a subscriber the turn is busy when Ready reports one in flight', () => {
    const attached = readied()
    const { seen, listener } = recorder()
    attached.channel.subscribe({ threadId: THREAD, listener })

    reconnect(attached)
    attached.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: true })

    expect(seen).toEqual([working(true)])
  })

  it('replays the busy state to a subscriber that joins after a Ready reporting a turn', () => {
    const attached = readied()
    reconnect(attached)
    attached.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: true })

    const { seen, listener } = recorder()
    attached.channel.subscribe({ threadId: THREAD, listener })

    expect(seen).toEqual([working(true)])
    expect(attached.channel.snapshot({ threadId: THREAD })).toEqual([working(true)])
  })

  it('lets a Ready listener read the already reconciled snapshot', () => {
    const attached = readied()
    attached.receive({ kind: EServeFrame.Signal, seq: 2, signal: working(true) })
    reconnect(attached)

    let snapshotAtReady: readonly ChannelSignal[] = []
    attached.channel.onReady(() => {
      snapshotAtReady = attached.channel.snapshot({ threadId: THREAD })
    })
    attached.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: false })

    expect(snapshotAtReady).toEqual([])
  })

  it('keeps the signal sequence intact so replayed signals after Ready still land in order', () => {
    const attached = readied()
    const { seen, listener } = recorder()
    attached.channel.subscribe({ threadId: THREAD, listener })
    attached.receive({ kind: EServeFrame.Signal, seq: 2, signal: working(true) })

    reconnect(attached)
    attached.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: false })
    attached.receive({ kind: EServeFrame.Signal, seq: 3, signal: working(true) })

    expect(seen).toEqual([working(true), working(false), working(true)])
  })
})
