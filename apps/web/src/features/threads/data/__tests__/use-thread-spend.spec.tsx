import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { SpendTally } from '@dltech/atlas-core'
import type { WireTurn } from '@dltech/atlas-wire/web'

import type { LiveChannel } from '../live-channel'
import { useThreadSpend } from '../use-thread-spend'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await unregisterDom()
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
  } as unknown as LiveChannel
  return { channel, requests }
}

type Props = { threadId: string; channel: LiveChannel | null; working: boolean }

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

const gatedChannel = (outputTokens: number) => {
  const gate = Promise.withResolvers<void>()
  const channel = {
    request: async () => {
      await gate.promise
      return { own: [turn(outputTokens)], delegated: [] }
    },
    onReady: () => () => undefined,
    onReload: () => () => undefined,
  } as unknown as LiveChannel
  return { channel, release: () => gate.resolve() }
}

describe('useThreadSpend', () => {
  it('reads nothing without a channel', async () => {
    const test = await mount({ threadId: 't', channel: null, working: false })
    try {
      expect(test.latest()).toBeNull()
    } finally {
      await test.unmount()
    }
  })

  it('reads the channel and refreshes when work settles', async () => {
    const { channel, requests } = fakeChannel(30)
    const test = await mount({ threadId: 't', channel, working: true })
    try {
      expect(test.latest()?.outputTokens).toBe(30)
      await test.render({ threadId: 't', channel, working: false })
      expect(requests).toHaveLength(2)
    } finally {
      await test.unmount()
    }
  })

  it('hides the previous thread’s spend while the next channel answers', async () => {
    const { channel } = fakeChannel(10)
    const test = await mount({ threadId: 'a', channel, working: false })
    try {
      expect(test.latest()?.outputTokens).toBe(10)
      const slow = gatedChannel(25)
      await test.render({ threadId: 'b', channel: slow.channel, working: false })
      expect(test.latest()).toBeNull()
      slow.release()
      await flush()
      expect(test.latest()?.outputTokens).toBe(25)
    } finally {
      await test.unmount()
    }
  })
})
