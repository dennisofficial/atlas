import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { NotifyEventToggles } from '../notify-event-toggles'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

const renderToggles = async (onToggle: (params: unknown) => void): Promise<void> => {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => {
    mounted.render(
      <NotifyEventToggles
        value={{ finished: false, errored: true, approval: true }}
        onToggle={onToggle}
      />,
    )
  })
}

const click = async (element: Element | null | undefined): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('NotifyEventToggles', () => {
  it('shows the three moments', async () => {
    await renderToggles(() => undefined)
    const labels = [...document.querySelectorAll('[aria-label]')].map((node) =>
      node.getAttribute('aria-label'),
    )
    expect(labels).toEqual(['Finished', 'Failed', 'Waiting for you'])
  })

  it('reports the moment the user turns on', async () => {
    const onToggle = mock(() => undefined)
    await renderToggles(onToggle)
    await click(document.querySelector('[aria-label="Finished"]'))
    expect(onToggle).toHaveBeenCalledWith({ moment: 'finished', enabled: true })
  })
})
