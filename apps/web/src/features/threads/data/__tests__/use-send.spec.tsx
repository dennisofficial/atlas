import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, jest, mock } from 'bun:test'
import { act } from 'react'

import type { ThreadMessageReply } from '@dltech/atlas-wire/web'

const errors: string[] = []
mock.module('sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: (message: string) => errors.push(message),
  }),
}))

const { SEND_DEADLINE_MS, SEND_TIMED_OUT } = await import('../send-message')
const { cloudThreadBackend } = await import('../thread-backend')
const { ThreadBackendProvider } = await import('../use-thread-backend')
const { useSend } = await import('../use-send')

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  jest.useRealTimers()
  errors.length = 0
})

const NOT_LIVE = () => false

async function mountWithUnansweredPost() {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const signals: (AbortSignal | undefined)[] = []
  const backend = {
    ...cloudThreadBackend,
    postMessage: (args: { signal?: AbortSignal | undefined }) => {
      signals.push(args.signal)
      return new Promise<ThreadMessageReply>(() => undefined)
    },
  }
  let latest: ReturnType<typeof useSend> | undefined
  function Probe() {
    latest = useSend()
    return null
  }
  await act(async () =>
    root.render(
      <ThreadBackendProvider backend={backend}>
        <Probe />
      </ThreadBackendProvider>,
    ),
  )
  const current = () => {
    if (latest === undefined) throw new Error('useSend did not render')
    return latest
  }
  return { current, signals, unmount: () => act(async () => root.unmount()) }
}

describe('useSend when Atlas Cloud never answers the send', () => {
  it('stops sending, aborts the request and surfaces the failure once the deadline passes', async () => {
    jest.useFakeTimers()
    const test = await mountWithUnansweredPost()
    try {
      let outcome: Promise<unknown> = Promise.resolve()
      await act(async () => {
        outcome = test.current().send({ threadId: 'thr_1', text: 'hello', liveSend: NOT_LIVE })
      })
      expect(test.current().sending).toBe(true)

      await act(async () => {
        jest.advanceTimersByTime(SEND_DEADLINE_MS)
      })

      expect(await outcome).toBeNull()
      expect(test.current().sending).toBe(false)
      expect(errors).toEqual([SEND_TIMED_OUT])
      expect(test.signals[0]?.aborted).toBe(true)
    } finally {
      await test.unmount()
    }
  })

  it('keeps sending until the deadline', async () => {
    jest.useFakeTimers()
    const test = await mountWithUnansweredPost()
    try {
      await act(async () => {
        void test.current().send({ threadId: 'thr_1', text: 'hello', liveSend: NOT_LIVE })
      })
      await act(async () => {
        jest.advanceTimersByTime(SEND_DEADLINE_MS - 1)
      })
      expect(test.current().sending).toBe(true)
      expect(errors).toEqual([])
    } finally {
      await test.unmount()
    }
  })
})
