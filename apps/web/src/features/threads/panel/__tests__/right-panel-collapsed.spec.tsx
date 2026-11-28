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
  it('defaults to collapsed', async () => {
    expect((await mount()).textContent).toBe('main:true')
  })

  it('persists an expansion for reloads', async () => {
    const main = await mount()
    await act(async () => buttonIn(main).click())
    expect(main.textContent).toBe('main:false')
    expect(window.localStorage.getItem(RIGHT_PANEL_COLLAPSED_KEY)).toBe('false')
    for (const root of roots.splice(0)) await act(async () => root.unmount())
    expect((await mount()).textContent).toBe('main:false')
  })

  it('hydrates collapsed server markup to a stored expansion without mismatch', async () => {
    const { hydrateRoot } = await import('react-dom/client')
    window.localStorage.setItem(RIGHT_PANEL_COLLAPSED_KEY, 'false')
    const html = renderToString(<Probe />)
    expect(html).toContain('true')
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
    expect(container.textContent).toBe('main:false')
  })

  it('follows a change from another tab', async () => {
    const main = await mount()
    await act(async () => {
      window.localStorage.setItem(RIGHT_PANEL_COLLAPSED_KEY, 'false')
      window.dispatchEvent(new StorageEvent('storage', { key: RIGHT_PANEL_COLLAPSED_KEY }))
    })
    expect(main.textContent).toBe('main:false')
    await act(async () => {
      window.localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(main.textContent).toBe('main:true')
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
      expect(main.textContent).toBe('main:false')
      expect(teammate.textContent).toBe('teammate:false')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
