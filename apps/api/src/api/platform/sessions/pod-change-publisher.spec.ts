import { EPodState, EThreadStreamFrame } from '@dltech/atlas-wire'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { Logger } from '@nestjs/common'
import * as podSnapshot from './pod-snapshot'
import type { ThreadPodSnapshot } from './pod-snapshot'
import { PodChangePublisher } from './pod-change-publisher'
import type { ThreadFrameSignal } from './thread-signal.bus'
import { emptyPodStatus, podSnapshotFrame } from './thread-stream.fixture'
import { ThreadSignalsService } from './thread-signals.service'
import { DrainStateService } from '../health/drain-state.service'

afterEach(() => mock.restore())

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('PodChangePublisher', () => {
  it('enriches once on the publishing side, not once per subscriber', async () => {
    const read = spyOn(podSnapshot, 'readPodFrame').mockResolvedValue(podSnapshotFrame({ rev: 1 }))
    const signals = new ThreadSignalsService(new DrainStateService())
    const list = spyOn(signals, 'listChangedForOwner').mockResolvedValue()
    const first = mock(() => {})
    const second = mock(() => {})
    signals.openStream({ threadId: 'thr-1', onFrame: first })
    signals.openStream({ threadId: 'thr-1', onFrame: second })
    await signals.podChanged({ threadId: 'thr-1' })
    expect(read).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith(podSnapshotFrame({ rev: 1 }))
    expect(second).toHaveBeenCalledWith(podSnapshotFrame({ rev: 1 }))
    expect(list).toHaveBeenCalledTimes(1)
    signals.closeAll()
  })

  it('logs read failure, publishes a legacy bare Pod and still invalidates the owner list', async () => {
    spyOn(podSnapshot, 'readPodFrame').mockRejectedValue(new Error('read unavailable'))
    const warn = spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const signals = new ThreadSignalsService(new DrainStateService())
    const list = spyOn(signals, 'listChangedForOwner').mockResolvedValue()
    const seen = mock(() => {})
    signals.openStream({ threadId: 'thr-1', onFrame: seen })
    await expect(signals.podChanged({ threadId: 'thr-1' })).resolves.toBeUndefined()
    expect(seen).toHaveBeenCalledWith({ type: EThreadStreamFrame.Pod })
    expect(list).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('read unavailable'))
    signals.closeAll()
  })

  it('serializes reads and publishes per thread while other threads remain independent', async () => {
    const first = Promise.withResolvers<ThreadPodSnapshot>()
    const read = spyOn(podSnapshot, 'readPodFrame')
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(podSnapshotFrame({ state: EPodState.Running, rev: 2 }))
    const publisher = new PodChangePublisher()
    const frames: ThreadFrameSignal[] = []
    const publish = async (signal: ThreadFrameSignal) => {
      frames.push(signal)
    }
    const listChanged = mock(async () => {})
    const one = publisher.publish({ threadId: 'thr-1', publish, listChanged })
    const two = publisher.publish({ threadId: 'thr-1', publish, listChanged })
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    const other = publisher.publish({ threadId: 'thr-2', publish, listChanged })
    await other
    expect(frames.map((frame) => frame.threadId)).toEqual(['thr-2'])
    first.resolve(podSnapshotFrame({ state: EPodState.Booting, rev: 1 }))
    await Promise.all([one, two])
    expect(read).toHaveBeenCalledTimes(3)
    expect(frames.filter((frame) => frame.threadId === 'thr-1')).toEqual([
      {
        threadId: 'thr-1',
        frame: {
          type: EThreadStreamFrame.Pod,
          status: { ...emptyPodStatus, state: EPodState.Booting, rev: 1 },
          rev: 1,
        },
      },
      {
        threadId: 'thr-1',
        frame: {
          type: EThreadStreamFrame.Pod,
          status: { ...emptyPodStatus, state: EPodState.Running, rev: 2 },
          rev: 2,
        },
      },
    ])
  })
})
