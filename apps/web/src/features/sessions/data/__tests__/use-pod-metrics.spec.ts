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

mock.module('@/lib/api-client', () => ({
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
  const seen: { series: readonly Sample[] } = { series: [] }
  function Probe(): null {
    seen.series = usePodMetrics(props) as readonly Sample[]
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
})
