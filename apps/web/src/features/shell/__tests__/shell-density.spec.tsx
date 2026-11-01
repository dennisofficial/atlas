import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { ESidebarDensity, useSidebarDensity } from '../shell-density'
import { ShellDisplayOptions } from '../shell-display-options'

const STORAGE_KEY = 'atlas:sidebar-density'
const roots: Root[] = []

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
})

function Probe({ label = 'main' }: { label?: string }) {
  const { density, setDensity } = useSidebarDensity()
  return (
    <button type="button" onClick={() => setDensity(ESidebarDensity.Compact)}>
      {label}:{density}
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
  if (button === null) throw new Error('Missing density control')
  return button
}

describe('sidebar density', () => {
  it('hydrates comfortable server markup to the persisted compact choice without mismatch', async () => {
    const { hydrateRoot } = await import('react-dom/client')
    window.localStorage.setItem(STORAGE_KEY, ESidebarDensity.Compact)
    const html = renderToString(<Probe />)
    expect(html).toContain('comfortable')
    expect(html).not.toContain('compact')
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
    expect(container.textContent).toBe('main:compact')
  })

  it('defaults to comfortable and ignores invalid stored values', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'unexpected')
    expect((await mount()).textContent).toBe('main:comfortable')
  })

  it('shares a choice across independent consumers and persists it for remounts', async () => {
    const main = await mount()
    const teammate = await mount(<Probe label="teammate" />)
    await act(async () => buttonIn(main).click())
    expect(main.textContent).toBe('main:compact')
    expect(teammate.textContent).toBe('teammate:compact')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('compact')
    for (const root of roots.splice(0)) await act(async () => root.unmount())
    expect((await mount()).textContent).toBe('main:compact')
  })

  it('keeps choices shared when storage reads and writes throw', async () => {
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
      expect(main.textContent).toBe('main:compact')
      expect(teammate.textContent).toBe('teammate:compact')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('updates all consumers when another tab changes or clears the preference', async () => {
    const main = await mount()
    await act(async () => {
      window.localStorage.setItem(STORAGE_KEY, 'compact')
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })
    expect(main.textContent).toBe('main:compact')
    await act(async () => {
      window.localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(main.textContent).toBe('main:comfortable')
  })

  it('offers accessible comfortable and compact radio choices from view options', async () => {
    const container = await mount(
      <>
        <ShellDisplayOptions />
        <Probe />
      </>,
    )
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Sidebar view options"]',
    )
    if (trigger === null) throw new Error('Missing view options')
    await act(async () => trigger.click())
    const choices = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(choices.map((choice) => choice.textContent)).toEqual(['Comfortable', 'Compact'])
    expect(choices[0]?.getAttribute('aria-checked')).toBe('true')
    await act(async () => choices[1]?.click())
    expect(container.textContent).toContain('main:compact')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('compact')
  })
})
