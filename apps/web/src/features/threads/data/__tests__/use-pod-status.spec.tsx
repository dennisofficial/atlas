import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { cloudThreadBackend } from '../thread-backend'
import { createThreadSignalHub } from '../thread-signal-hub'
import { ThreadBackendProvider } from '../use-thread-backend'
import { usePodStatus } from '../use-pod-status'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))

async function mount(args?: { pending?: boolean; local?: boolean }) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const hub = createThreadSignalHub()
  const reads: string[] = []
  const releases: ((status: PodStatus) => void)[] = []
  const backend = {
    ...cloudThreadBackend,
    local: args?.local ?? false,
    fetchPod: (threadId: string) => {
      reads.push(threadId)
      if (args?.pending) return new Promise<PodStatus>((resolve) => releases.push(resolve))
      return Promise.resolve({ state: EPodState.Booting, steps: [] })
    },
  }
  let latest: ReturnType<typeof usePodStatus> | undefined
  function Probe({ threadId }: { threadId: string }) {
    latest = usePodStatus({ threadId, signals: hub })
    return null
  }
  const render = (threadId: string) =>
    act(async () =>
      root.render(
        <ThreadBackendProvider backend={backend}>
          <Probe threadId={threadId} />
        </ThreadBackendProvider>,
      ),
    )
  await render('thr_1')
  return {
    hub,
    reads,
    releases,
    render,
    latest: () => latest,
    unmount: () => act(async () => root.unmount()),
  }
}

describe('usePodStatus', () => {
  it('uses Pod payloads without GETs, ignores Started and fetches for bare Pod and manual refresh', async () => {
    const test = await mount()
    try {
      expect(test.reads).toEqual(['thr_1'])
      const status = { state: EPodState.Running, steps: [] }
      await act(async () => {
        test.hub.emitPod({ status })
        test.hub.emitStarted()
        test.hub.emitStarted()
      })
      expect(test.latest()?.pod).toEqual(status)
      expect(test.reads).toEqual(['thr_1'])
      await act(async () => test.hub.emitPod())
      await flush()
      expect(test.reads).toEqual(['thr_1', 'thr_1'])
      await act(async () => test.latest()?.refresh())
      await flush()
      expect(test.reads).toEqual(['thr_1', 'thr_1', 'thr_1'])
    } finally {
      await test.unmount()
    }
  })

  it('holds the newest Pod revision across reconnect and resets it on a thread switch', async () => {
    const test = await mount()
    try {
      const running = { state: EPodState.Running, steps: [] }
      await act(async () => test.hub.emitPod({ status: running, rev: 6 }))
      await act(async () => {
        test.hub.emitStarted()
        test.hub.emitPod({ status: { state: EPodState.Booting, steps: [] }, rev: 5 })
        test.hub.emitPod({ status: { state: EPodState.Failed, steps: [] }, rev: 6 })
      })
      expect(test.latest()?.pod).toEqual(running)
      expect(test.reads).toEqual(['thr_1'])
      const parked = { state: EPodState.Parked, steps: [] }
      await act(async () => test.hub.emitPod({ status: parked, rev: 7 }))
      expect(test.latest()?.pod).toEqual(parked)
      expect(test.reads).toEqual(['thr_1'])
      await test.render('thr_2')
      await act(async () => test.hub.emitPod({ status: running, rev: 0 }))
      expect(test.latest()?.pod).toEqual(running)
      expect(test.reads).toEqual(['thr_1', 'thr_2'])
    } finally {
      await test.unmount()
    }
  })

  it('keeps fresh manual HTTP results eligible when stale or duplicate payloads arrive', async () => {
    const test = await mount({ pending: true })
    try {
      await act(async () => test.releases[0]?.({ state: EPodState.Booting, steps: [] }))
      const running = { state: EPodState.Running, steps: [] }
      await act(async () => test.hub.emitPod({ status: running, rev: 6 }))
      await act(async () => test.latest()?.refresh())
      await act(async () => {
        test.hub.emitPod({ status: { state: EPodState.Booting, steps: [] }, rev: 5 })
        test.hub.emitPod({ status: running, rev: 6 })
      })
      const fresh = { ...running, resources: { sandboxId: 'sandbox_1', region: 'iad1', vcpus: 8 } }
      await act(async () => test.releases[1]?.(fresh))
      expect(test.latest()?.pod).toEqual(fresh)
      expect(test.reads).toEqual(['thr_1', 'thr_1'])
    } finally {
      await test.unmount()
    }
  })

  it('raises the stream revision floor from initial and manual GETs', async () => {
    const test = await mount({ pending: true })
    try {
      const initial = { state: EPodState.Booting, steps: [], rev: 4 }
      await act(async () => test.releases[0]?.(initial))
      await act(async () =>
        test.hub.emitPod({ status: { state: EPodState.Failed, steps: [] }, rev: 3 }),
      )
      expect(test.latest()?.pod).toEqual(initial)
      await act(async () => test.latest()?.refresh())
      const running = { state: EPodState.Running, steps: [], rev: 6 }
      await act(async () => test.releases[1]?.(running))
      await act(async () => {
        test.hub.emitPod({ status: { state: EPodState.Booting, steps: [] }, rev: 5 })
        test.hub.emitPod({ status: running, rev: 6 })
      })
      expect(test.latest()?.pod).toEqual(running)
      const parked = { state: EPodState.Parked, steps: [], rev: 7 }
      await act(async () => test.hub.emitPod({ status: parked }))
      expect(test.latest()?.pod).toEqual(parked)
      expect(test.reads).toEqual(['thr_1', 'thr_1'])
    } finally {
      await test.unmount()
    }
  })

  it('accepts equal-revision manual HTTP resource refreshes after a streamed frame', async () => {
    const test = await mount({ pending: true })
    try {
      const running = { state: EPodState.Running, steps: [], rev: 6 }
      await act(async () => test.hub.emitPod({ status: running, rev: 6 }))
      await act(async () => test.releases[0]?.({ ...running, rev: 7, state: EPodState.Failed }))
      expect(test.latest()?.pod).toEqual(running)
      await act(async () => test.latest()?.refresh())
      const refreshed = {
        ...running,
        resources: { sandboxId: 'sandbox_1', region: 'iad1', vcpus: 8 },
      }
      await act(async () => test.releases[1]?.(refreshed))
      expect(test.latest()?.pod).toEqual(refreshed)
      await act(async () =>
        test.hub.emitPod({ status: { state: EPodState.Booting, steps: [] }, rev: 6 }),
      )
      expect(test.latest()?.pod).toEqual(refreshed)
    } finally {
      await test.unmount()
    }
  })

  it('keeps local desktop initial and manual fetching without a stream', async () => {
    const test = await mount({ local: true })
    try {
      await flush()
      expect(test.latest()?.pod?.state).toBe(EPodState.Booting)
      await act(async () => test.latest()?.refresh())
      await flush()
      expect(test.reads).toEqual(['thr_1', 'thr_1'])
    } finally {
      await test.unmount()
    }
  })

  it('ignores late GETs after payloads and after switching thread or stopping', async () => {
    const test = await mount({ pending: true })
    const live = { state: EPodState.Running, steps: [] }
    await act(async () => test.hub.emitPod({ status: live }))
    await act(async () => test.releases[0]?.({ state: EPodState.Booting, steps: [] }))
    expect(test.latest()?.pod).toEqual(live)
    await act(async () => test.latest()?.refresh())
    await test.render('thr_2')
    expect(test.latest()?.pod).toBeNull()
    await act(async () => test.releases[1]?.({ state: EPodState.Parked, steps: [] }))
    expect(test.latest()?.pod).toBeNull()
    await act(async () => test.hub.emitPod({ status: live }))
    expect(test.latest()?.pod).toEqual(live)
    await test.unmount()
    test.hub.emitPod({ status: { state: EPodState.Failed, steps: [] } })
    test.releases[2]?.({ state: EPodState.Failed, steps: [] })
    await flush()
    expect(test.latest()?.pod).toEqual(live)
    expect(test.reads).toEqual(['thr_1', 'thr_1', 'thr_2'])
  })
})
