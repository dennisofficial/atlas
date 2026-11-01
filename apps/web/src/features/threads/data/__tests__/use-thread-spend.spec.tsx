import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { SpendTally } from '@dltech/atlas-core'
import type { WireTurn } from '@dltech/atlas-wire/web'

import { fakeFetch, trpcOk } from './trpc-fake'

import type { ServeChannel } from '../live-thread-view'
import { useThreadSpend } from '../use-thread-spend'

const realFetch = globalThis.fetch

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 5)))

const turn = (outputTokens: number): WireTurn => ({
  runId: 'r',
  threadId: 't',
  status: 'done',
  providerId: 'nobody',
  modelId: 'unpriced',
  steps: 1,
  inputTokens: 100,
  outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  startedAt: '',
  endedAt: '',
  durationMs: 1,
})

const fakeChannel = (outputTokens: number) => {
  const requests: unknown[] = []
  const channel = {
    request: async (request: unknown) => {
      requests.push(request)
      return { own: [turn(outputTokens)], delegated: [] }
    },
    onReady: () => () => undefined,
    onReload: () => () => undefined,
  } as unknown as ServeChannel
  return { channel, requests }
}

type Props = { threadId: string; channel: ServeChannel | null; working: boolean }

async function mount(initial: Props) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let latest: SpendTally | null = null
  function Probe(props: Props) {
    latest = useThreadSpend(props)
    return null
  }
  const render = (props: Props) => act(async () => root.render(<Probe {...props} />))
  await render(initial)
  await flush()
  return {
    render: async (props: Props) => {
      await render(props)
      await flush()
    },
    latest: () => latest,
    unmount: () => act(async () => root.unmount()),
  }
}

describe('useThreadSpend', () => {
  it('reads the API when there is no channel and refreshes when work settles', async () => {
    let outputTokens = 10
    const calls = fakeFetch(() => trpcOk([turn(outputTokens)]))
    const test = await mount({ threadId: 't', channel: null, working: true })
    try {
      expect(calls).toHaveLength(1)
      expect(test.latest()?.outputTokens).toBe(10)
      outputTokens = 25
      await test.render({ threadId: 't', channel: null, working: false })
      expect(calls).toHaveLength(2)
      expect(test.latest()?.outputTokens).toBe(25)
    } finally {
      await test.unmount()
    }
  })

  it('reads the channel and never the API when one is connected', async () => {
    const calls = fakeFetch(() => trpcOk([turn(1)]))
    const { channel, requests } = fakeChannel(30)
    const test = await mount({ threadId: 't', channel, working: true })
    try {
      expect(test.latest()?.outputTokens).toBe(30)
      await test.render({ threadId: 't', channel, working: false })
      expect(requests).toHaveLength(2)
      expect(calls).toHaveLength(0)
    } finally {
      await test.unmount()
    }
  })

  it('switches lanes when the channel connects and drops the parked reading when it leaves', async () => {
    const calls = fakeFetch(() => trpcOk([turn(10)]))
    const { channel } = fakeChannel(30)
    const test = await mount({ threadId: 't', channel: null, working: false })
    try {
      expect(test.latest()?.outputTokens).toBe(10)
      await test.render({ threadId: 't', channel, working: false })
      expect(test.latest()?.outputTokens).toBe(30)
      await test.render({ threadId: 't', channel: null, working: false })
      expect(calls).toHaveLength(2)
      expect(test.latest()?.outputTokens).toBe(10)
    } finally {
      await test.unmount()
    }
  })

  it('hides the previous thread’s spend while the new thread loads', async () => {
    fakeFetch(() => trpcOk([turn(10)]))
    const test = await mount({ threadId: 'a', channel: null, working: false })
    try {
      expect(test.latest()?.outputTokens).toBe(10)
      const gate = Promise.withResolvers<void>()
      const answering = globalThis.fetch
      globalThis.fetch = Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          await gate.promise
          return answering(input, init)
        },
        { preconnect: fetch.preconnect },
      )
      await test.render({ threadId: 'b', channel: null, working: false })
      expect(test.latest()).toBeNull()
      gate.resolve()
      await flush()
      expect(test.latest()?.outputTokens).toBe(10)
    } finally {
      await test.unmount()
    }
  })
})
