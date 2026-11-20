import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { activeTabOf, currentUrlOf } from '@/features/threads/data/preview-browser/browser-model'
import { usePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'
import type { PreviewsState } from '@/features/threads/data/use-previews'
import { usePreviewsContext } from '@/features/threads/panel/previews-context'

import { SessionPreviewsProvider } from '../browser/previews-provider'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const roots = new Set<Root>()

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
})

const port = (serviceId: string): PreviewPort => ({
  id: `service:${serviceId}`,
  port: 4321,
  label: 'web',
  url: 'http://localhost:4321',
  status: EPreviewStatus.Live,
})

let mounts = 0

async function mount(onOpened: () => void) {
  const sessionId = `provider-${++mounts}`
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  roots.add(root)
  let latest: { context: PreviewsState; url: string | undefined } = {
    context: { ports: [], loaded: false, openUrl: () => undefined },
    url: undefined,
  }
  function Probe() {
    const context = usePreviewsContext()
    const { state } = usePreviewBrowser(sessionId)
    const active = activeTabOf(state)
    latest = { context, url: active === undefined ? undefined : currentUrlOf(active) }
    return null
  }
  await act(async () =>
    root.render(
      <SessionPreviewsProvider
        sessionId={sessionId}
        ports={[port('svc-web')]}
        loaded
        onOpened={onOpened}
      >
        <Probe />
      </SessionPreviewsProvider>,
    ),
  )
  return () => latest
}

describe('SessionPreviewsProvider', () => {
  it('hands the session view ports and its loaded state to the transcript', async () => {
    const state = await mount(() => undefined)
    expect(state().context.ports).toEqual([port('svc-web')])
    expect(state().context.loaded).toBe(true)
  })

  it('opens a link in the session browser and tells the pane to show it', async () => {
    let calls = 0
    const state = await mount(() => {
      calls += 1
    })
    await act(async () => state().context.openUrl('http://localhost:4321/files'))
    expect(state().url).toBe('http://localhost:4321/files')
    expect(calls).toBe(1)
  })
})
