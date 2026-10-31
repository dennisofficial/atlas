import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'
import { DrainStateService } from '../health/drain-state.service'
import { InProcessThreadSignalBus, ThreadSignalBus, type ThreadSignal } from './thread-signal.bus'
import { ThreadSignalsService } from './thread-signals.service'

class FakeBus extends ThreadSignalBus {
  readonly distributed = true
  readonly published: ThreadSignal[] = []
  readonly subscriptions: Array<(raw: string) => void> = []
  closed = 0
  failPublish = false

  async publish(args: ThreadSignal): Promise<void> {
    if (this.failPublish) throw new Error('redis down')
    this.published.push(args)
  }

  subscribe({ onMessage }: { onMessage: (raw: string) => void }): void {
    this.subscriptions.push(onMessage)
  }

  async close(): Promise<void> {
    this.closed += 1
  }

  receive(raw: string): void {
    for (const onMessage of this.subscriptions) onMessage(raw)
  }
}

const HEAD = (head: number): ThreadStreamFrame => ({ type: EThreadStreamFrame.Head, head })

describe('ThreadSignalsService', () => {
  it('routes a frame to the streams of its thread only', async () => {
    const signals = new ThreadSignalsService(new DrainStateService())
    const first: ThreadStreamFrame[] = []
    const second: ThreadStreamFrame[] = []
    signals.openStream({ threadId: 'thr_1', onFrame: (frame) => first.push(frame) })
    signals.openStream({ threadId: 'thr_2', onFrame: (frame) => second.push(frame) })

    await signals.headMoved({ threadId: 'thr_1', head: 3 })
    await signals.podChanged({ threadId: 'thr_2' })

    expect(first).toEqual([HEAD(3)])
    expect(second).toEqual([{ type: EThreadStreamFrame.Pod }])
  })

  it('delivers to every stream open on the same thread and stops after unsubscribe', async () => {
    const signals = new ThreadSignalsService(new DrainStateService())
    const first: ThreadStreamFrame[] = []
    const second: ThreadStreamFrame[] = []
    const closeFirst = signals.openStream({ threadId: 'thr_1', onFrame: (f) => first.push(f) })
    signals.openStream({ threadId: 'thr_1', onFrame: (f) => second.push(f) })

    await signals.headMoved({ threadId: 'thr_1', head: 1 })
    closeFirst()
    await signals.headMoved({ threadId: 'thr_1', head: 2 })

    expect(first).toEqual([HEAD(1)])
    expect(second).toEqual([HEAD(1), HEAD(2)])
  })

  it('publishes through a distributed bus and delivers only what the subscriber receives', async () => {
    const bus = new FakeBus()
    const signals = new ThreadSignalsService(new DrainStateService(), bus)
    const seen: ThreadStreamFrame[] = []
    signals.openStream({ threadId: 'thr_1', onFrame: (frame) => seen.push(frame) })

    await signals.headMoved({ threadId: 'thr_1', head: 5 })
    expect(seen).toEqual([])
    expect(bus.published).toEqual([{ threadId: 'thr_1', frame: HEAD(5) }])

    bus.receive(JSON.stringify(bus.published[0]))
    expect(seen).toEqual([HEAD(5)])
  })

  it('subscribes once, lazily, and again after closeAll', () => {
    const bus = new FakeBus()
    const signals = new ThreadSignalsService(new DrainStateService(), bus)
    expect(bus.subscriptions).toHaveLength(0)

    signals.openStream({ threadId: 'thr_1', onFrame: () => {} })
    signals.openStream({ threadId: 'thr_2', onFrame: () => {} })
    expect(bus.subscriptions).toHaveLength(1)

    signals.closeAll()
    signals.openStream({ threadId: 'thr_1', onFrame: () => {} })
    expect(bus.subscriptions).toHaveLength(2)
  })

  it('ignores malformed messages and keeps delivering', async () => {
    const bus = new FakeBus()
    const signals = new ThreadSignalsService(new DrainStateService(), bus)
    const seen: ThreadStreamFrame[] = []
    signals.openStream({ threadId: 'thr_1', onFrame: (frame) => seen.push(frame) })

    bus.receive('not json')
    bus.receive(JSON.stringify({ threadId: 'thr_1', frame: { type: 'mystery' } }))
    bus.receive(JSON.stringify({ threadId: 'thr_1', frame: HEAD(9) }))

    expect(seen).toEqual([HEAD(9)])
  })

  it('never throws when the bus fails to publish', async () => {
    const bus = new FakeBus()
    bus.failPublish = true
    const signals = new ThreadSignalsService(new DrainStateService(), bus)

    await expect(signals.podChanged({ threadId: 'thr_1' })).resolves.toBeUndefined()
    expect(bus.published).toEqual([])
  })

  it('isolates a throwing stream handler from the others', async () => {
    const signals = new ThreadSignalsService(new DrainStateService())
    const seen: ThreadStreamFrame[] = []
    signals.openStream({
      threadId: 'thr_1',
      onFrame: () => {
        throw new Error('boom')
      },
    })
    signals.openStream({ threadId: 'thr_1', onFrame: (frame) => seen.push(frame) })

    await signals.headMoved({ threadId: 'thr_1', head: 1 })

    expect(seen).toEqual([HEAD(1)])
  })

  it('closes every open stream and the bus when the process drains', () => {
    const bus = new FakeBus()
    const drain = new DrainStateService()
    const signals = new ThreadSignalsService(drain, bus)
    const closed: string[] = []
    signals.openStream({ threadId: 'thr_1', onFrame: () => {}, onClosed: () => closed.push('a') })
    signals.openStream({ threadId: 'thr_2', onFrame: () => {}, onClosed: () => closed.push('b') })

    drain.beginDrain()

    expect(closed.sort()).toEqual(['a', 'b'])
    expect(bus.closed).toBe(1)
  })

  it('onModuleDestroy closes streams and the bus', async () => {
    const bus = new FakeBus()
    const signals = new ThreadSignalsService(new DrainStateService(), bus)
    const closed: string[] = []
    signals.openStream({ threadId: 'thr_1', onFrame: () => {}, onClosed: () => closed.push('a') })

    await signals.onModuleDestroy()

    expect(closed).toEqual(['a'])
    expect(bus.closed).toBeGreaterThanOrEqual(1)
  })

  it('works with the in-process bus by default', async () => {
    const signals = new ThreadSignalsService(
      new DrainStateService(),
      new InProcessThreadSignalBus(),
    )
    const seen: ThreadStreamFrame[] = []
    signals.openStream({ threadId: 'thr_1', onFrame: (frame) => seen.push(frame) })

    await signals.headMoved({ threadId: 'thr_1', head: 2 })

    expect(seen).toEqual([HEAD(2)])
  })
})
