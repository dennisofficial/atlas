import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, expect, it, spyOn } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'

import { DesktopError } from '@/features/desktop/desktop-http'
import { SHELL_THREADS_KEY } from '@/lib/cloud-keys'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { loadShellEntries } from '../load-shell-entries'
import { useShellEntries } from '../use-shell-entries'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  Reflect.deleteProperty(document, 'visibilityState')
})

it('reports local availability transitions once without hiding successful Cloud results', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  const notify = spyOn(toast, 'error').mockImplementation(() => 'local-availability')
  const client = createTestQueryClient()
  const failure = new DesktopError({ status: 503, message: 'Host unavailable' })
  const loaded = await loadShellEntries({
    cloud: async () => [{ project: null, sessions: [] }],
    local: async () => {
      throw failure
    },
  })
  const publish = async (value: typeof loaded) => {
    await act(async () => {
      client.setQueryData([SHELL_THREADS_KEY], { value })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })
  }
  let visibleEntries: unknown
  function Probe() {
    visibleEntries = useShellEntries(null).data
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
    expect(visibleEntries).toEqual([{ project: null, sessions: [] }])
    expect(notify).toHaveBeenCalledWith("Couldn't refresh local threads: Host unavailable")
    await publish({
      ...loaded,
      startedAt: loaded.startedAt + 1,
      localError: new Error('Still down'),
    })
    expect(notify).toHaveBeenCalledTimes(1)
    await publish({ ...loaded, localError: null })
    await publish(loaded)
    expect(notify).toHaveBeenCalledTimes(2)
    await publish({ ...loaded, cloudError: new Error('Cloud unavailable') })
    expect(notify).toHaveBeenLastCalledWith(
      "Couldn't refresh local threads: Host unavailable. Cloud threads are also unavailable: Cloud unavailable",
    )
    expect(notify).toHaveBeenCalledTimes(3)
  } finally {
    notify.mockRestore()
    client.clear()
  }
})
