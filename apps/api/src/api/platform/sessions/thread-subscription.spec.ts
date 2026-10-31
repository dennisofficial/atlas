import {
  EThreadLiveFrame,
  EThreadStreamFrame,
  type ThreadLiveFrame,
  type ThreadStreamFrame,
} from '@dltech/atlas-wire'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { DrainStateService } from '../health/drain-state.service'
import { InProcessThreadSignalBus } from './thread-signal.bus'
import { attachLiveStream } from './thread-live-stream'
import { ThreadSignalsService } from './thread-signals.service'

class DelayedBus extends InProcessThreadSignalBus {
  readonly acknowledgment = Promise.withResolvers<void>()
  subscriptions = 0

  override subscribe(args: { onMessage: (raw: string) => void }): Promise<void> {
    super.subscribe(args)
    this.subscriptions += 1
    return this.acknowledgment.promise
  }
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function open(args: { bus: DelayedBus }) {
  const signals = new ThreadSignalsService(new DrainStateService(), args.bus)
  const frames: ThreadLiveFrame[] = []
  const readSnapshot = mock(async () => ({ rows: [], projects: [] }))
  const close = mock(() => {})
  const detach = attachLiveStream({
    signals,
    userId: 'user',
    readSnapshot,
    sink: { push: (frame) => frames.push(frame), close },
  })
  cleanups.push(() => {
    detach()
    signals.closeAll()
  })
  return { signals, frames, readSnapshot, close }
}

describe('live subscription readiness', () => {
  it('waits for acknowledgment before reading and buffers an early signal exactly once', async () => {
    const bus = new DelayedBus()
    const { frames, readSnapshot } = open({ bus })
    await flush()
    expect(readSnapshot).not.toHaveBeenCalled()
    await bus.publish({ userId: 'user', projectId: 'project', removed: true })
    expect(frames).toEqual([])

    bus.acknowledgment.resolve()
    await flush()

    expect(readSnapshot).toHaveBeenCalledTimes(1)
    expect(frames).toEqual([
      { type: EThreadLiveFrame.Snapshot, rows: [], projects: [] },
      { type: EThreadLiveFrame.ProjectRemove, projectId: 'project' },
    ])
  })

  it('shares readiness across watches and never reads on rejection', async () => {
    const bus = new DelayedBus()
    const { signals, frames, readSnapshot, close } = open({ bus })
    const second = mock(() => {})
    signals.watchLive({ userId: 'other', onSignal: () => {}, onClosed: second })
    expect(bus.subscriptions).toBe(1)

    bus.acknowledgment.reject(new Error('subscribe failed'))
    await flush()

    expect(close).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(readSnapshot).not.toHaveBeenCalled()
    expect(frames).toEqual([])
  })

  it('handles rejection when only an old stream consumer is subscribed', async () => {
    const bus = new DelayedBus()
    const signals = new ThreadSignalsService(new DrainStateService(), bus)
    cleanups.push(() => signals.closeAll())
    const close = mock(() => {})
    signals.openStream({ threadId: 'thread', onFrame: () => {}, onClosed: close })
    bus.acknowledgment.reject(new Error('subscribe failed'))
    await flush()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not read after draining while acknowledgment is pending', async () => {
    const bus = new DelayedBus()
    const { signals, readSnapshot, close } = open({ bus })
    signals.closeAll()
    bus.acknowledgment.resolve()
    await flush()
    expect(close).toHaveBeenCalledTimes(1)
    expect(readSnapshot).not.toHaveBeenCalled()
  })

  it('keeps old streams synchronous with a void-returning bus', async () => {
    const bus = new InProcessThreadSignalBus()
    const signals = new ThreadSignalsService(new DrainStateService(), bus)
    cleanups.push(() => signals.closeAll())
    const frames: ThreadStreamFrame[] = []
    signals.openStream({ threadId: 'thread', onFrame: (frame) => frames.push(frame) })
    const published = bus.publish({ threadId: 'thread', frame: { type: EThreadStreamFrame.Title } })
    expect(frames).toEqual([{ type: EThreadStreamFrame.Title }])
    await published
  })
})
