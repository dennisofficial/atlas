import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { RIGHT_PANEL_COLLAPSED_KEY, useRightPanelCollapsed } from '../right-panel-collapsed'

const roots: Root[] = []

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

beforeEach(() => {
  window.localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
})

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
})

function Probe({ label = 'main' }: { label?: string }) {
  const { collapsed, setCollapsed } = useRightPanelCollapsed()
  return (
    <button type="button" onClick={() => setCollapsed(!collapsed)}>
      {label}:{String(collapsed)}
    </button>
  )
}

async function mount(element = <Probe />) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return container
}

function buttonIn(container: Element): HTMLButtonElement {
  const button = container.querySelector('button')
  if (button === null) throw new Error('Missing panel toggle')
  return button
}

describe('right panel collapsed', () => {
  it('defaults to expanded', async () => {
    expect((await mount()).textContent).toBe('main:false')
  })

  it('persists the collapsed flag for reloads', async () => {
    const main = await mount()
    await act(async () => buttonIn(main).click())
    expect(main.textContent).toBe('main:true')
    expect(window.localStorage.getItem(RIGHT_PANEL_COLLAPSED_KEY)).toBe('true')
    for (const root of roots.splice(0)) await act(async () => root.unmount())
    expect((await mount()).textContent).toBe('main:true')
  })

  it('hydrates expanded server markup to a stored collapse without mismatch', async () => {
    const { hydrateRoot } = await import('react-dom/client')
    window.localStorage.setItem(RIGHT_PANEL_COLLAPSED_KEY, 'true')
    const html = renderToString(<Probe />)
    expect(html).toContain('false')
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)
    const errors: unknown[] = []
    await act(async () => {
      roots.push(
        hydrateRoot(container, <Probe />, { onRecoverableError: (error) => errors.push(error) }),
      )
    })
    expect(errors).toEqual([])
    expect(container.textContent).toBe('main:true')
  })

  it('follows a collapse from another tab', async () => {
    const main = await mount()
    await act(async () => {
      window.localStorage.setItem(RIGHT_PANEL_COLLAPSED_KEY, 'true')
      window.dispatchEvent(new StorageEvent('storage', { key: RIGHT_PANEL_COLLAPSED_KEY }))
    })
    expect(main.textContent).toBe('main:true')
    await act(async () => {
      window.localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(main.textContent).toBe('main:false')
  })

  it('keeps toggling in memory when storage reads and writes throw', async () => {
    const getItem = spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    const setItem = spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    try {
      const main = await mount()
      const teammate = await mount(<Probe label="teammate" />)
      await act(async () => buttonIn(main).click())
      expect(main.textContent).toBe('main:true')
      expect(teammate.textContent).toBe('teammate:true')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
