import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { notifyManager } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, expect, it, spyOn } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'

import { localSummary } from '@/features/desktop/__tests__/local-thread-fixture'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import type { LocalEntriesLoad } from '../load-shell-entries'
import { LOCAL_SHELL_THREADS_KEY, useLocalShellEntries } from '../use-local-shell-entries'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  notifyManager.setScheduler(queueMicrotask)
})
afterAll(async () => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0))
  await GlobalRegistrator.unregister()
})

let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  Reflect.deleteProperty(document, 'visibilityState')
  Reflect.deleteProperty(window, 'atlasDesktop')
})

it('reports a local collection outage once per transition while retaining its last snapshot', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  Reflect.set(window, 'atlasDesktop', {})
  const notify = spyOn(toast, 'error').mockImplementation(() => 'local-availability')
  const client = createTestQueryClient()
  const loaded: LocalEntriesLoad = { threads: [localSummary], error: new Error('Host unavailable') }
  const publish = async (value: LocalEntriesLoad) =>
    act(async () => {
      client.setQueryData([LOCAL_SHELL_THREADS_KEY], value)
    })
  let visibleEntries: unknown
  function Probe() {
    visibleEntries = useLocalShellEntries().data?.threads
    return null
  }
  try {
    await publish(loaded)
    root = createRoot(document.createElement('div'))
    await act(async () =>
      root?.render(
        <TestQueryProvider client={client}>
          <Probe />
        </TestQueryProvider>,
      ),
    )
    expect(visibleEntries).toEqual([localSummary])
    expect(notify).toHaveBeenCalledWith("Couldn't refresh local threads: Host unavailable")
    await publish({ ...loaded, error: new Error('Still down') })
    expect(notify).toHaveBeenCalledTimes(1)
    await publish({ ...loaded, error: null })
    await publish(loaded)
    expect(notify).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root?.unmount())
    root = undefined
    notify.mockRestore()
    client.clear()
  }
})

it('does not make local HTTP requests from a hosted browser or hidden native sidebar', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected request'))
  const client = createTestQueryClient()
  let reload: (() => void) | undefined
  function Probe() {
    reload = useLocalShellEntries().reload
    return null
  }
  root = createRoot(document.createElement('div'))
  try {
    await act(async () =>
      root?.render(
        <TestQueryProvider client={client}>
          <Probe />
        </TestQueryProvider>,
      ),
    )
    await act(async () => reload?.())
    expect(fetch).not.toHaveBeenCalled()
    Reflect.set(window, 'atlasDesktop', {})
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => reload?.())
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    await act(async () => root?.unmount())
    root = undefined
    fetch.mockRestore()
    client.clear()
  }
})
