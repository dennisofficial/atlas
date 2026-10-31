import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EChangeScope } from '@dltech/atlas-wire/web'

import { cloudThreadBackend, type ThreadBackend } from '../thread-backend'
import { EPodConnectOutcome } from '../pod-connect'
import { createThreadSignalHub } from '../thread-signal-hub'
import { ThreadBackendProvider } from '../use-thread-backend'
import { useThreadSource, type ThreadSource } from '../use-thread-source'
import { useGitChanges } from '../use-git-changes'
import { event } from './live-thread-fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('local thread source', () => {
  it('mounts the retained session despite pod ineligibility without waking passive panels', async () => {
    let mints = 0
    let wakes = 0
    let seeds = 0
    let log = [event(1)]
    const reads: (number | undefined)[] = []
    let held: ThreadSource | null = null
    const { fetchSnapshot: cloudSnapshot, ...cloudWithoutSnapshot } = cloudThreadBackend
    const backend: ThreadBackend = {
      ...cloudWithoutSnapshot,
      local: true,
      fetchSeed: async () => {
        seeds += 1
        return log
      },
      fetchEvents: async ({ fromSeq }) => {
        reads.push(fromSeq)
        return log.filter((entry) => fromSeq === undefined || entry.seq >= fromSeq)
      },
      mint: async () => {
        mints += 1
        return { outcome: EPodConnectOutcome.NotRunning }
      },
      wake: async () => {
        wakes += 1
        throw new Error('wake unavailable')
      },
    }
    const hub = createThreadSignalHub()
    function Probe() {
      const source = useThreadSource({ threadId: 'thr_1', signals: hub, liveEligible: false })
      held = source
      useGitChanges({ channel: source.channel, scope: EChangeScope.All, working: source.working })
      return null
    }
    const source = (): ThreadSource => {
      if (!held) throw new Error('source not mounted')
      return held
    }
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        <ThreadBackendProvider backend={backend}>
          <Probe />
        </ThreadBackendProvider>,
      ),
    )
    expect(mints).toBe(1)
    expect(wakes).toBe(0)
    expect(source().events.map((entry) => entry.seq)).toEqual([1])
    expect(source().channel).toBeNull()
    expect(typeof source().prepareRewind).toBe('function')
    expect(seeds).toBe(1)

    log = [event(1), event(4)]
    await act(async () => hub.emitHead(4))
    expect(source().events).toEqual(log)
    expect(reads).toEqual([1])
    log = [{ ...event(1), id: 'evt_rewritten' }]
    await act(async () => hub.emitHead(1))
    expect(source().events).toEqual(log)
    expect(reads).toEqual([1, undefined])
    expect(wakes).toBe(0)
    expect(seeds).toBe(1)

    await act(async () => {
      expect(source().sendLive({ text: 'go', requestId: 'req_local' })).toBe(true)
    })
    expect(wakes).toBe(1)
    const send = source().sendLive
    await act(async () => root.unmount())
    expect(send({ text: 'late', requestId: 'req_late' })).toBe(false)
    expect(wakes).toBe(1)
  })
})
