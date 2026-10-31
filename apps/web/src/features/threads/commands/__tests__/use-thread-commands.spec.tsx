import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import { cloudThreadBackend } from '../../data/thread-backend'
import { ThreadBackendProvider } from '../../data/use-thread-backend'
import { useThreadCommands } from '../use-thread-commands'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

it('local rename uses the host and refreshes the stored title while parked', async () => {
  const rename = mock(async (_args: { threadId: string; title: string }) => undefined)
  const onRenamed = mock(() => undefined)
  const retryBoot = mock(async () => undefined)
  let commands: ReturnType<typeof useThreadCommands> | undefined
  function Probe() {
    commands = useThreadCommands({
      threadId: 'thr_1',
      channel: null,
      live: false,
      projectId: null,
      working: false,
      rightPanel: { setTab: () => undefined, setSheetOpen: () => undefined },
      retryBoot,
      refresh: () => undefined,
      onRenamed,
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  const router = {
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: async () => undefined,
    hmrRefresh: () => undefined,
  }
  try {
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router}>
          <ThreadBackendProvider backend={{ ...cloudThreadBackend, local: true, rename }}>
            <Probe />
          </ThreadBackendProvider>
        </AppRouterContext.Provider>,
      ),
    )
    await act(async () => {
      await commands?.handleCommand('/rename Local title')
    })
    expect(rename).toHaveBeenCalledWith({
      threadId: 'thr_1',
      title: 'Local title',
    })
    expect(onRenamed).toHaveBeenCalledTimes(1)
    expect(retryBoot).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
  }
})
