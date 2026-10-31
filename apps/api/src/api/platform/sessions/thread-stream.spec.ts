import { EPodState, EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { DrainStateService } from '../health/drain-state.service'
import { emptyPodStatus, metadataFrame, podSnapshotFrame } from './thread-stream.fixture'
import { InProcessThreadSignalBus } from './thread-signal.bus'
import { ThreadSignalsService } from './thread-signals.service'
import { attachThreadStream, THREAD_STREAM_BUFFER_LIMIT } from './thread-stream'
import type { ThreadMetadataFrame } from './thread-stream-state'
import type { ThreadPodSnapshot } from './pod-snapshot'

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve()
}
const closers: Array<() => void> = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})

function open(
  args: {
    readMetadata?: () => Promise<ThreadMetadataFrame>
    readPod?: () => Promise<ThreadPodSnapshot>
    subscription?: Promise<void>
  } = {},
) {
  const signals = new ThreadSignalsService(new DrainStateService(), new InProcessThreadSignalBus())
  const frames: ThreadStreamFrame[] = []
  const close = mock(() => {})
  const readHead = mock(async () => 7)
  const readMetadata = mock(
    args.readMetadata ?? (async () => metadataFrame({ threadId: 'thr_1', rev: 2 })),
  )
  const readPod = mock(args.readPod ?? (async () => podSnapshotFrame()))
  const detach = attachThreadStream({
    signals: {
      openStream: (input) => signals.openStream(input),
      awaitSubscription: () => args.subscription ?? signals.awaitSubscription(),
    },
    threadId: 'thr_1',
    readHead,
    readMetadata,
    readPod,
    sink: { push: (frame) => frames.push(frame), close },
  })
  closers.push(detach, () => signals.closeAll())
  return { signals, frames, close, detach, readHead, readMetadata, readPod }
}

const head: ThreadStreamFrame = { type: EThreadStreamFrame.Head, head: 7 }
const pod = podSnapshotFrame()

describe('attachThreadStream state bootstrap', () => {
  it('waits for subscriber readiness, preserves first Head, and emits read-only Meta and Pod', async () => {
    const gate = Promise.withResolvers<void>()
    const opened = open({ subscription: gate.promise })
    await flush()
    expect(opened.readHead).not.toHaveBeenCalled()
    expect(opened.readMetadata).not.toHaveBeenCalled()
    expect(opened.readPod).not.toHaveBeenCalled()
    gate.resolve()
    await flush()
    expect(opened.frames).toEqual([head, metadataFrame({ threadId: 'thr_1', rev: 2 }), pod])
  })

  it('buffers without gaps and drops stale or duplicate Meta before and after bootstrap', async () => {
    const gate = Promise.withResolvers<ThreadMetadataFrame>()
    const { signals, frames } = open({ readMetadata: () => gate.promise })
    await flush()
    const publishMeta = (rev: number) =>
      signals.publish({ threadId: 'thr_1', frame: metadataFrame({ threadId: 'thr_1', rev }) })
    await publishMeta(1)
    await publishMeta(2)
    await publishMeta(3)
    await signals.publish({ threadId: 'thr_1', frame: { type: EThreadStreamFrame.Title } })
    gate.resolve(metadataFrame({ threadId: 'thr_1', rev: 2 }))
    await flush()
    await publishMeta(2)
    await publishMeta(3)
    await publishMeta(4)
    expect(frames).toEqual([
      head,
      metadataFrame({ threadId: 'thr_1', rev: 2 }),
      pod,
      metadataFrame({ threadId: 'thr_1', rev: 3 }),
      { type: EThreadStreamFrame.Title },
      metadataFrame({ threadId: 'thr_1', rev: 4 }),
    ])
  })

  it('drops stale buffered and delayed Pod revisions against the initial snapshot independently of Meta', async () => {
    const gate = Promise.withResolvers<ThreadPodSnapshot>()
    const { signals, frames } = open({ readPod: () => gate.promise })
    await flush()
    const publishPod = (rev: number) =>
      signals.publish({ threadId: 'thr_1', frame: podSnapshotFrame({ rev }) })
    await publishPod(4)
    await publishPod(5)
    await publishPod(7)
    gate.resolve(podSnapshotFrame({ rev: 5 }))
    await flush()
    await publishPod(6)
    await publishPod(7)
    await signals.publish({
      threadId: 'thr_1',
      frame: metadataFrame({ threadId: 'thr_1', rev: 3 }),
    })
    await publishPod(8)
    expect(frames).toEqual([
      head,
      metadataFrame({ threadId: 'thr_1', rev: 2 }),
      podSnapshotFrame({ rev: 5 }),
      podSnapshotFrame({ rev: 7 }),
      metadataFrame({ threadId: 'thr_1', rev: 3 }),
      podSnapshotFrame({ rev: 8 }),
    ])
  })

  it('discards buffered Pod snapshots and refreshes once instead of replaying stale status', async () => {
    const gate = Promise.withResolvers<ThreadPodSnapshot>()
    let reads = 0
    const running = podSnapshotFrame({ state: EPodState.Running, rev: 1 })
    const { signals, frames, readPod } = open({
      readPod: () => (++reads === 1 ? gate.promise : Promise.resolve(running)),
    })
    await flush()
    await signals.publish({
      threadId: 'thr_1',
      frame: {
        type: EThreadStreamFrame.Pod,
        status: { ...emptyPodStatus, state: EPodState.Booting },
      },
    })
    gate.resolve(podSnapshotFrame())
    await flush()
    expect(readPod).toHaveBeenCalledTimes(2)
    expect(frames).toEqual([head, metadataFrame({ threadId: 'thr_1', rev: 2 }), running])
  })

  it('uses a bare Pod invalidation if dirtied again during the one refresh', async () => {
    const first = Promise.withResolvers<ThreadPodSnapshot>()
    const second = Promise.withResolvers<ThreadPodSnapshot>()
    let reads = 0
    const { signals, frames, readPod } = open({
      readPod: () => (++reads === 1 ? first.promise : second.promise),
    })
    await flush()
    await signals.publish({ threadId: 'thr_1', frame: { type: EThreadStreamFrame.Pod } })
    first.resolve(podSnapshotFrame())
    await flush()
    await signals.publish({ threadId: 'thr_1', frame: { type: EThreadStreamFrame.Pod } })
    second.resolve(podSnapshotFrame())
    await flush()
    expect(readPod).toHaveBeenCalledTimes(2)
    expect(frames).toEqual([
      head,
      metadataFrame({ threadId: 'thr_1', rev: 2 }),
      pod,
      { type: EThreadStreamFrame.Pod },
    ])
  })

  it('closes on overflow and suppresses late snapshot completion', async () => {
    const gate = Promise.withResolvers<ThreadMetadataFrame>()
    const { signals, frames, close } = open({ readMetadata: () => gate.promise })
    await flush()
    for (let i = 0; i <= THREAD_STREAM_BUFFER_LIMIT; i += 1)
      await signals.publish({ threadId: 'thr_1', frame: { type: EThreadStreamFrame.Title } })
    expect(close).toHaveBeenCalledTimes(1)
    gate.resolve(metadataFrame({ threadId: 'thr_1' }))
    await flush()
    expect(frames).toEqual([])
  })

  it('closes on subscription failure without reading', async () => {
    const gate = Promise.withResolvers<void>()
    const { close, readHead, readPod } = open({ subscription: gate.promise })
    gate.reject(new Error('subscription failed'))
    await flush()
    expect(close).toHaveBeenCalledTimes(1)
    expect(readHead).not.toHaveBeenCalled()
    expect(readPod).not.toHaveBeenCalled()
  })

  it('closes on read failure and does not emit a partial snapshot', async () => {
    const { close, frames } = open({
      readMetadata: async () => {
        throw new Error('read failed')
      },
    })
    await flush()
    expect(close).toHaveBeenCalledTimes(1)
    expect(frames).toEqual([])
  })

  it('detaches or drains while reading without later emitting', async () => {
    for (const drain of [false, true]) {
      const gate = Promise.withResolvers<ThreadMetadataFrame>()
      const { signals, detach, frames, close } = open({ readMetadata: () => gate.promise })
      await flush()
      if (drain) signals.closeAll()
      else detach()
      gate.resolve(metadataFrame({ threadId: 'thr_1' }))
      await flush()
      expect(frames).toEqual([])
      expect(close).toHaveBeenCalledTimes(drain ? 1 : 0)
    }
  })
})
