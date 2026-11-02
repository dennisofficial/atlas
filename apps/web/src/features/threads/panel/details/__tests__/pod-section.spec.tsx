import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { ThreadPanelProvider, type ThreadPanelValue } from '../../thread-panel-context'
import { EMPTY_DETAILS } from '../details-input'
import { PodSection } from '../pod-section'

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
  const value: Pick<ThreadPanelValue, 'pod' | 'working' | 'details'> = {
    pod,
    working: false,
    details: EMPTY_DETAILS,
  }
  await act(async () =>
    root.render(
      <ThreadPanelProvider value={value as ThreadPanelValue}>
        <PodSection />
      </ThreadPanelProvider>,
    ),
  )
}

describe('PodSection', () => {
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

  it('shows no version line when the pod never reported one', async () => {
    await renderWith({
      state: EPodState.Parked,
      steps: [],
      resources: { sandboxId: 'sbx_1', region: 'iad1' },
    })
    expect(container.textContent).not.toContain('atlas-serve')
  })
})
