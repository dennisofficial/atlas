import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { EPrFrameKind, type PrFrame } from './github-pr-fanout.frame'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { PrFrameBus } from './github-pr-fanout.transport'
import { EPrEventKind, type GithubPrEventDto, type GithubPrStateDto } from './github-realtime.types'

const EVENT: GithubPrEventDto = {
  id: 'evt_1',
  repoFullName: 'compai/app',
  prNumber: 42,
  kind: EPrEventKind.Verdict,
  payload: { url: 'https://github.com/compai/app/pull/42', verdict: 'green', headSha: 'abc123' },
  createdAt: '2026-09-28T00:00:00.000Z',
}

const STATE: GithubPrStateDto = {
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: true,
  updatedAt: '2026-09-28T00:00:00.000Z',
}

class FakeBus extends PrFrameBus {
  readonly distributed = true
  readonly published: PrFrame[] = []
  readonly subscriptions: ((raw: string) => void)[] = []
  closed = 0
  failPublish = false

  async publish({ frame }: { frame: PrFrame }): Promise<void> {
    if (this.failPublish) throw new Error('upstash down')
    this.published.push(frame)
  }

  subscribe({ onMessage }: { onMessage: (raw: string) => void }): void {
    this.subscriptions.push(onMessage)
  }

  async close(): Promise<void> {
    this.closed += 1
  }

  receive({ raw }: { raw: string }): void {
    for (const onMessage of this.subscriptions) onMessage(raw)
  }
}

function distributedFanout(): { fanout: GithubPrFanoutService; bus: FakeBus } {
  const bus = new FakeBus()
  return { fanout: new GithubPrFanoutService(new DrainStateService(), bus), bus }
}

describe('GithubPrFanoutService over a bus', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('publishes one frame per flush and delivers nothing locally by itself', async () => {
    const { fanout, bus } = distributedFanout()
    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr_a', handler: (state) => received.push(state) })

    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 1 } })
    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 2 } })
    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 3 } })
    await advanceTimersByTimeAsync(1_100)

    expect(bus.published).toHaveLength(2)
    expect(bus.published[0]).toMatchObject({ kind: EPrFrameKind.State, userIds: ['usr_a'] })
    expect(received).toHaveLength(0)
  })

  it('publishes an event frame carrying the latest ackId of the coalesced window', async () => {
    const { fanout, bus } = distributedFanout()

    fanout.pushEvent({ userIds: ['usr_a'], event: EVENT, ackId: 'row_1' })
    fanout.pushEvent({ userIds: ['usr_a'], event: { ...EVENT, id: 'evt_2' }, ackId: 'row_2' })
    fanout.pushEvent({ userIds: ['usr_a'], event: { ...EVENT, id: 'evt_3' }, ackId: 'row_3' })
    await advanceTimersByTimeAsync(1_100)

    expect(bus.published.map((frame) => frame.kind)).toEqual([
      EPrFrameKind.Event,
      EPrFrameKind.Event,
    ])
    expect(bus.published[0]).toMatchObject({ ackId: 'row_1' })
    expect(bus.published[1]).toMatchObject({ ackId: 'row_3', payload: { id: 'evt_3' } })
  })

  it('subscribes once, lazily, on the first openStream', () => {
    const { fanout, bus } = distributedFanout()
    expect(bus.subscriptions).toHaveLength(0)

    fanout.openStream({ userId: 'usr_a', handler: () => {} })
    fanout.openStream({ userId: 'usr_b', handler: () => {} })

    expect(bus.subscriptions).toHaveLength(1)
  })

  it('delivers a received state frame to the local streams of the addressed users', () => {
    const { fanout, bus } = distributedFanout()
    const receivedA: GithubPrStateDto[] = []
    const receivedB: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr_a', handler: (state) => receivedA.push(state) })
    fanout.openStream({ userId: 'usr_b', handler: (state) => receivedB.push(state) })

    bus.receive({
      raw: JSON.stringify({ kind: EPrFrameKind.State, userIds: ['usr_a'], payload: STATE }),
    })

    expect(receivedA).toEqual([STATE])
    expect(receivedB).toHaveLength(0)
  })

  it('delivers a received event frame and fires the ack handler with its ackId', () => {
    const { fanout, bus } = distributedFanout()
    const received: GithubPrEventDto[] = []
    const acks: unknown[] = []
    fanout.onEventDelivered((ack) => acks.push(ack))
    fanout.openStream({
      userId: 'usr_a',
      handler: () => {},
      eventHandler: (event) => received.push(event),
    })

    bus.receive({
      raw: JSON.stringify({
        kind: EPrFrameKind.Event,
        userIds: ['usr_a', 'usr_offline'],
        payload: EVENT,
        ackId: 'row_1',
      }),
    })

    expect(received).toEqual([EVENT])
    expect(acks).toEqual([{ ackId: 'row_1', userId: 'usr_a', userStream: true, threadIds: [] }])
  })

  it('does not ack a frame without an ackId', () => {
    const { fanout, bus } = distributedFanout()
    const acks: unknown[] = []
    fanout.onEventDelivered((ack) => acks.push(ack))
    fanout.openStream({ userId: 'usr_a', handler: () => {}, eventHandler: () => {} })

    bus.receive({
      raw: JSON.stringify({ kind: EPrFrameKind.Event, userIds: ['usr_a'], payload: EVENT }),
    })

    expect(acks).toHaveLength(0)
  })

  it('delivers a self-published frame exactly once, through the subscriber', async () => {
    const { fanout, bus } = distributedFanout()
    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr_a', handler: (state) => received.push(state) })

    fanout.push({ userIds: ['usr_a'], state: STATE })
    for (const frame of bus.published) bus.receive({ raw: JSON.stringify(frame) })
    await advanceTimersByTimeAsync(1_100)

    expect(bus.published).toHaveLength(1)
    expect(received).toHaveLength(1)
  })

  it('ignores a malformed frame and keeps delivering', () => {
    const { fanout, bus } = distributedFanout()
    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr_a', handler: (state) => received.push(state) })

    bus.receive({ raw: 'not json' })
    bus.receive({
      raw: JSON.stringify({ kind: 'state', userIds: ['usr_a'], payload: { nope: 1 } }),
    })
    bus.receive({ raw: JSON.stringify({ kind: 'mystery', userIds: ['usr_a'] }) })
    bus.receive({
      raw: JSON.stringify({ kind: EPrFrameKind.State, userIds: ['usr_a'], payload: STATE }),
    })

    expect(received).toEqual([STATE])
  })

  it('drops a frame whose publish failed without throwing', async () => {
    const { fanout, bus } = distributedFanout()
    bus.failPublish = true

    expect(() => fanout.push({ userIds: ['usr_a'], state: STATE })).not.toThrow()
    await advanceTimersByTimeAsync(1_100)

    expect(bus.published).toHaveLength(0)
  })

  it('resubscribes on the first stream opened after closeAll', () => {
    const { fanout, bus } = distributedFanout()
    fanout.openStream({ userId: 'usr_a', handler: () => {} })
    fanout.closeAll()

    fanout.openStream({ userId: 'usr_a', handler: () => {} })

    expect(bus.subscriptions).toHaveLength(2)
  })

  it('closeAll quits the subscriber', () => {
    const { fanout, bus } = distributedFanout()
    fanout.openStream({ userId: 'usr_a', handler: () => {} })

    fanout.closeAll()

    expect(bus.closed).toBe(1)
  })

  it('onModuleDestroy closes the streams and quits the subscriber', async () => {
    const { fanout, bus } = distributedFanout()
    const closed: string[] = []
    fanout.openStream({ userId: 'usr_a', handler: () => {}, onClosed: () => closed.push('a') })

    await fanout.onModuleDestroy()

    expect(closed).toEqual(['a'])
    expect(bus.closed).toBeGreaterThanOrEqual(1)
  })

  it('delivers directly in local-only mode', () => {
    const fanout = new GithubPrFanoutService(new DrainStateService())
    const received: GithubPrStateDto[] = []
    const acks: string[] = []
    fanout.onEventDelivered(({ ackId }) => acks.push(ackId))
    fanout.openStream({
      userId: 'usr_a',
      handler: (state) => received.push(state),
      eventHandler: () => {},
    })

    fanout.push({ userIds: ['usr_a'], state: STATE })
    fanout.pushEvent({ userIds: ['usr_a'], event: EVENT, ackId: 'row_1' })

    expect(received).toEqual([STATE])
    expect(acks).toEqual(['row_1'])
  })
})
