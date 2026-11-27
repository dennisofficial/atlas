import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

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

async function mount(onOpen: (url: string) => void) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  roots.add(root)
  let latest: { context: PreviewsState } = {
    context: { ports: [], loaded: false, openUrl: () => undefined },
  }
  function Probe() {
    latest = { context: usePreviewsContext() }
    return null
  }
  await act(async () =>
    root.render(
      <SessionPreviewsProvider ports={[port('svc-web')]} loaded onOpen={onOpen}>
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

  it('opens a transcript link through the session pane, which wakes a sleeping pod first', async () => {
    const opened: string[] = []
    const state = await mount((url) => opened.push(url))
    await act(async () => state().context.openUrl('http://localhost:4321/files'))
    expect(opened).toEqual(['http://localhost:4321/files'])
  })
})
