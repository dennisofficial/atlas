import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { clearCloudCache } from '@/lib/query-client'

import { createLiveChatSession } from '../live-chat-session'
import { EPodConnectOutcome } from '../pod-connect'
import type { ThreadBackend } from '../thread-backend'
import { createThreadSignalHub } from '../thread-signal-hub'
import { useThreadSource } from '../use-thread-source'
import { ThreadBackendProvider } from '../use-thread-backend'
import { flush, ticketOf } from './live-thread-fixture'
import type { LiveThreadState } from '../live-thread-view'
import { IDLE_LIVE_THREAD } from '../live-thread-view'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  clearCloudCache()
})

const event = (seq: number): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'user-said',
  body: '{}',
})

const unused = (what: string) => async (): Promise<never> => {
  throw new Error(`not used: ${what}`)
}

function rig() {
  const seeds: number[] = []
  const reads: { fromSeq: number | undefined }[] = []
  const backend: ThreadBackend = {
    local: false,
    fetchThread: unused('fetchThread'),
    fetchPod: unused('fetchPod'),
    fetchEvents: async ({ fromSeq }) => {
      reads.push({ fromSeq: fromSeq ?? undefined })
      if (fromSeq === undefined) return [event(1), event(2), event(3)]
      if (fromSeq === 2) return [event(2), event(3)]
      if (fromSeq === 3) return [event(3)]
      return []
    },
    fetchSeed: async () => {
      seeds.push(1)
      return [event(1), event(2)]
    },
    readStoredThread: unused('readStoredThread'),
    fetchSpawned: async () => [],
    mint: async () => ({ outcome: EPodConnectOutcome.NotRunning }),
    postMessage: unused('postMessage'),
    takeBack: unused('takeBack'),
    patchModel: unused('patchModel'),
    rewind: async () => undefined,
    provision: async () => undefined,
    resize: unused('resize'),
    markRead: async () => undefined,
    subscribeStream: () => ({ unsubscribe: () => undefined }),
    afterConnect: () => undefined,
  }
  const hub = createThreadSignalHub()

  function Probe() {
    useThreadSource({ threadId: 'thr_1', signals: hub, liveEligible: true })
    return null
  }

  const mount = async () => {
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        <ThreadBackendProvider backend={backend}>
          <Probe />
        </ThreadBackendProvider>,
      ),
    )
    return () => act(async () => root.unmount())
  }

  return { seeds, reads, hub, mount }
}

describe('opening a running thread', () => {
  it('reads the full history once through the seed, then deltas after the held head', async () => {
    const test = rig()
    const unmount = await test.mount()
    await flush()
    expect(test.reads).toEqual([])

    await act(async () => {
      test.hub.emitHead(3)
    })
    await flush()
    await flush()
    expect(test.seeds.length).toBeLessThanOrEqual(2)
    expect(test.reads).toEqual([{ fromSeq: 2 }])
    await unmount()
  })

  it('re-reads the full log once when a delta does not reach the announced head', async () => {
    const test = rig()
    const unmount = await test.mount()
    await flush()

    await act(async () => {
      test.hub.emitHead(9)
    })
    await flush()
    await flush()
    await flush()
    await flush()
    await flush()
    await flush()
    expect(test.seeds.length).toBeLessThanOrEqual(2)
    expect(test.reads).toEqual([{ fromSeq: 2 }, { fromSeq: undefined }])
    await unmount()
  })
})

describe('opening a live thread', () => {
  it('mints the ticket in parallel with the seed read', async () => {
    let seedWaiting: (() => void) | null = null
    let mintWaiting: (() => void) | null = null
    let state: LiveThreadState = IDLE_LIVE_THREAD
    const session = createLiveChatSession({
      threadId: 'thr_1',
      mint: () =>
        new Promise((resolve) => {
          mintWaiting = () => resolve(ticketOf('tkt1'))
        }),
      readSeed: () =>
        new Promise((resolve) => {
          seedWaiting = () => resolve([event(1), event(2)])
        }),
      onChange: (next) => {
        state = next
      },
    })

    session.controller.start()
    await flush()
    expect(seedWaiting).not.toBeNull()
    expect(mintWaiting).not.toBeNull()
    mintWaiting?.()
    await flush()
    expect(state.events).toEqual([])
    seedWaiting?.()
    session.controller.stop()
  })
})
