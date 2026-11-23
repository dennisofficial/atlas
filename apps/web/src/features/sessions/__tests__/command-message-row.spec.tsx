import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { CommandMessageRow } from '../command-message-row'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
}

describe('CommandMessageRow', () => {
  it('draws the typed line exactly, with the name in mono', async () => {
    await mount(<CommandMessageRow text="/rename bench session" timestamp="10:04 AM" />)

    const message = document.body.querySelector('[data-slot="message"]')
    expect(message?.getAttribute('data-align')).toBe('end')
    expect(message?.textContent).toContain('/rename bench session')

    const mono = document.body.querySelector('.font-mono')
    expect(mono?.textContent).toBe('/rename')
    expect(document.body.querySelector('[data-slot="bubble"]')).toBeNull()
  })

  it('keeps the timestamp and the argument text in the same line', async () => {
    await mount(<CommandMessageRow text="/compact" timestamp="Yesterday 9:12 AM" />)

    expect(document.body.querySelector('.font-mono')?.textContent).toBe('/compact')
    expect(document.body.textContent).toContain('Yesterday 9:12 AM')
  })

  it('draws no timestamp when the event has none', async () => {
    await mount(<CommandMessageRow text="/help" />)

    expect(document.body.textContent).toBe('/help')
  })
})
