import { mock } from 'bun:test'

type Handlers = {
  onData: (value: unknown) => void
  onError: (failure: unknown) => void
  onComplete: () => void
}

type Opened = {
  sessionId: string
  handlers: Handlers
  unsubscribe: ReturnType<typeof mock>
}

const opened: Opened[] = []

const realApiClient = { ...(await import('@/lib/api-client')) }

mock.module('@/lib/api-client', () => ({
  cloudCall: <T>(promise: Promise<T>): Promise<T> => promise,
  api: {
    sessions: {
      podMetrics: {
        subscribe: (input: { sessionId: string }, handlers: Handlers) => {
          const unsubscribe = mock(() => undefined)
          opened.push({ sessionId: input.sessionId, handlers, unsubscribe })
          return { unsubscribe }
        },
      },
    },
  },
}))

const { registerDom, unregisterDom } = await import('@/lib/__tests__/happy-dom-globals')
const { afterAll, afterEach, beforeAll, describe, expect, it } = await import('bun:test')
const { act, createElement } = await import('react')
const { usePodMetrics } = await import('../use-pod-metrics')

const SESSION = 'ses_1'
const RESUBSCRIBE_MS = 2_000

const sample = (at: number) => ({
  at,
  cpuPercent: 10,
  ramBytes: 1024,
  ramLimitBytes: 2048,
  throttled: false,
  oomKills: 0,
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type Sample = { t: number; cpu: number }

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('@/lib/api-client', () => realApiClient)
  await unregisterDom()
})

afterEach(() => {
  opened.length = 0
  document.body.innerHTML = ''
})

const mount = async (props: { sessionId: string; enabled?: boolean }) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const seen: { series: readonly Sample[]; unavailable: boolean } = {
    series: [],
    unavailable: false,
  }
  function Probe(): null {
    const state = usePodMetrics(props)
    seen.series = state.series as readonly Sample[]
    seen.unavailable = state.unavailable
    return null
  }
  let root: ReturnType<typeof createRoot> | undefined
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(Probe))
  })
  return {
    seen,
    unmount: async () => {
      await act(async () => root?.unmount())
    },
  }
}

describe('usePodMetrics', () => {
  it('subscribes for the session and unsubscribes on unmount', async () => {
    const { seen, unmount } = await mount({ sessionId: SESSION })
    expect(opened.map((entry) => entry.sessionId)).toEqual([SESSION])
    await act(async () => {
      opened[0]?.handlers.onData({ type: 'samples', samples: [sample(1_000)] })
    })
    expect(seen.series).toEqual([
      { t: 1_000, cpu: 10, ramGb: 1024 / 1024 ** 3, throttled: false, oomKills: 0 },
    ])
    await unmount()
    expect(opened[0]?.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('resubscribes when the stream completes while enabled', async () => {
    const { seen, unmount } = await mount({ sessionId: SESSION })
    await act(async () => {
      opened[0]?.handlers.onData({ type: 'samples', samples: [sample(1_000)] })
      opened[0]?.handlers.onComplete()
    })
    expect(opened).toHaveLength(1)
    expect(opened[0]?.unsubscribe).toHaveBeenCalledTimes(1)
    await act(async () => {
      await sleep(RESUBSCRIBE_MS + 200)
    })
    expect(opened).toHaveLength(2)
    expect(seen.series).toHaveLength(1)
    await unmount()
    expect(opened[1]?.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('stops retrying once the pod says usage is unavailable', async () => {
    const { seen, unmount } = await mount({ sessionId: SESSION })
    await act(async () => {
      opened[0]?.handlers.onData({ type: 'unavailable', reason: 'pod metrics are not readable' })
    })
    expect(seen.unavailable).toBe(true)
    expect(opened[0]?.unsubscribe).toHaveBeenCalledTimes(1)
    await act(async () => {
      await sleep(RESUBSCRIBE_MS + 200)
    })
    expect(opened).toHaveLength(1)
    await unmount()
  })

  it('clears the unavailable reading when it is disabled', async () => {
    const { seen, unmount } = await mount({ sessionId: SESSION, enabled: false })
    expect(opened).toHaveLength(0)
    expect(seen.unavailable).toBe(false)
    await unmount()
  })
})
