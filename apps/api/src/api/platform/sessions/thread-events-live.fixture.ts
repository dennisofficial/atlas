import { EThreadStreamFrame, type ThreadStreamFrame, type WireEvent } from '@dltech/atlas-wire'
import { mock } from 'bun:test'
import { DrainStateService } from '../health/drain-state.service'
import { ThreadSignalsService } from './thread-signals.service'
import { orderedThreadEvents } from './thread-events-live'
import { metadataFrame, podSnapshotFrame } from './thread-stream.fixture'
import type { EventSnapshotReader } from './thread-events-snapshot'

export const streamEvent = (seq: number): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-31T00:00:00.000Z',
  type: 'user-said',
  body: '{}',
})

export const eventBatch = (args: { seqs: number[]; historyRev?: number }): ThreadStreamFrame => ({
  type: EThreadStreamFrame.Events,
  fromSeq: args.seqs[0] ?? 1,
  events: args.seqs.map(streamEvent),
  historyRev: args.historyRev ?? 0,
})

export function openOrderedEvents(
  args: {
    head?: number
    historyRev?: number
    lastEventId?: string
    readSnapshot?: EventSnapshotReader
    subscription?: Promise<void>
  } = {},
) {
  const drain = new DrainStateService()
  const signals = new ThreadSignalsService(drain)
  signals.threadChanged = () => {}
  const controller = new AbortController()
  const readSnapshot = mock(
    args.readSnapshot ??
      (async (options) => ({
        head: args.head ?? 3,
        historyRev: args.historyRev ?? 0,
        events:
          options.stateOnly === true
            ? []
            : Array.from({ length: args.head ?? 3 }, (_, index) => streamEvent(index + 1)).filter(
                (event) => event.seq >= (options.fromSeq ?? 0),
              ),
      })),
  )
  const stream = orderedThreadEvents({
    threadId: 'thr_1',
    lastEventId: args.lastEventId,
    signal: controller.signal,
    signals: {
      openStream: (input) => signals.openStream(input),
      awaitSubscription: () => args.subscription ?? signals.awaitSubscription(),
    },
    readSnapshot,
    readMetadata: async () => metadataFrame({ threadId: 'thr_1' }),
    readPod: async () => podSnapshotFrame(),
  })
  const publish = (frame: ThreadStreamFrame) => signals.publish({ threadId: 'thr_1', frame })
  const close = () => {
    controller.abort()
    signals.closeAll()
  }
  return { signals, stream, controller, drain, publish, close, readSnapshot }
}

export const flushEventStream = async (): Promise<void> => {
  for (let index = 0; index < 50; index += 1) await Promise.resolve()
}
