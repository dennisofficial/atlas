import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import {
  activeTabOf,
  closeTab,
  openTab,
} from '@/features/threads/data/preview-browser/browser-model'
import { updatePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'

import { BrowserTab } from '../browser/browser-tab'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const roots = new Set<Root>()

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
})

const livePort: PreviewPort = {
  id: 'service:svc-web',
  port: 4321,
  label: 'web',
  url: 'http://localhost:4321',
  status: EPreviewStatus.Live,
}

let mounts = 0

const closeAll = (sessionId: string): void => {
  updatePreviewBrowser({
    threadId: sessionId,
    change: ({ state }) => {
      const active = activeTabOf(state)
      return active === undefined ? state : closeTab({ state, id: active.id })
    },
  })
}

const openOn = (sessionId: string, url: string): void => {
  updatePreviewBrowser({
    threadId: sessionId,
    change: ({ state }) => openTab({ state, url }),
  })
}

async function mount(
  seed: { empty: boolean; url?: string },
  ports: readonly PreviewPort[] = [livePort],
) {
  const sessionId = `browser-${++mounts}`
  if (seed.empty) closeAll(sessionId)
  if (seed.url !== undefined) openOn(sessionId, seed.url)
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  await act(async () => root.render(<BrowserTab sessionId={sessionId} ports={ports} loaded />))
  return container
}

const buttonLabelled = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  )
  if (button === undefined) throw new Error(`no ${label} button`)
  return button
}

describe('BrowserTab', () => {
  it('says nothing is open until a tab is asked for', async () => {
    const container = await mount({ empty: true })
    expect(container.textContent).toContain('No tabs open')
  })

  it('opens the browser chrome from the notice', async () => {
    const container = await mount({ empty: true })
    await act(async () => buttonLabelled(container, 'New tab').click())
    expect(container.querySelector('input[aria-label="Address"]')).not.toBeNull()
  })

  it('titles an open tab from its url and marks it live', async () => {
    const container = await mount({ empty: true, url: 'http://localhost:4321' })
    const tab = container.querySelector('[role="tab"][aria-selected="true"]')
    expect(tab?.getAttribute('title')).toBe('http://localhost:4321')
    expect(container.textContent).toContain('localhost:4321')
    expect(container.querySelector('.bg-success')).not.toBeNull()
  })

  it('offers the session ports to a new tab', async () => {
    const container = await mount({ empty: true })
    await act(async () => buttonLabelled(container, 'New tab').click())
    expect(container.textContent).toContain('Open a port')
    expect(container.textContent).toContain('web')
    expect(container.textContent).toContain(':4321')
  })
})
