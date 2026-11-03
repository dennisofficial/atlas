import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { ThreadPanelProvider, type ThreadPanelValue } from '../../thread-panel-context'
import { EMPTY_DETAILS } from '../details-input'
import { HeadSection } from '../head-section'

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await GlobalRegistrator.unregister()
})

async function renderWith(pod: PodStatus | null) {
  const value: Pick<ThreadPanelValue, 'pod' | 'working' | 'details' | 'threadId' | 'channel'> = {
    pod,
    working: false,
    threadId: 't',
    channel: null,
    details: EMPTY_DETAILS,
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ThreadPanelProvider value={value as ThreadPanelValue}>
          <HeadSection />
        </ThreadPanelProvider>
      </QueryClientProvider>,
    ),
  )
}

describe('HeadSection pod', () => {
  it('says no pod yet before any pod exists', async () => {
    await renderWith(null)
    expect(container.textContent).toContain('No pod yet')
  })

  it('says no pod yet for a pod that never started', async () => {
    await renderWith({ state: EPodState.None, steps: [] })
    expect(container.textContent).toContain('No pod yet')
  })

  it('names the state of a running pod whose resources are missing', async () => {
    await renderWith({ state: EPodState.Running, steps: [] })
    expect(container.textContent).toContain('Running')
    expect(container.textContent).not.toContain('No pod yet')
  })

  it('shows the atlas-serve version the pod reported', async () => {
    await renderWith({
      state: EPodState.Running,
      steps: [],
      resources: { sandboxId: 'sbx_1', region: 'iad1', serveVersion: '1.94.2' },
    })
    expect(container.textContent).toContain('atlas-serve 1.94.2')
  })

  it('shows no version when the pod never reported one', async () => {
    await renderWith({
      state: EPodState.Parked,
      steps: [],
      resources: { sandboxId: 'sbx_1', region: 'iad1' },
    })
    expect(container.textContent).not.toContain('atlas-serve')
  })
})
