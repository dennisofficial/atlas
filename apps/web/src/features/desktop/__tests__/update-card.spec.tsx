import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { UpdateCard } from '../update-card'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const realFetch = globalThis.fetch
let calls: { path: string; method: string }[]
let body: unknown

beforeEach(() => {
  calls = []
  body = { state: 'idle' }
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ path: String(input), method })
      if (method === 'POST') {
        body = { state: 'restarting', version: '1.2.3' }
        return new Response(null, { status: 202 })
      }
      return Response.json(body)
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  await act(async () => undefined)
  return () => act(async () => root.unmount())
}

const asDesktop = () => Reflect.set(window, 'atlasDesktop', {})
const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label') === name,
  )

describe('UpdateCard', () => {
  it('is hidden and silent outside the desktop app', async () => {
    body = { state: 'ready', version: '1.2.3' }
    const unmount = await mount(<UpdateCard />)
    expect(document.body.textContent).toBe('')
    expect(calls).toEqual([])
    await unmount()
  })

  it('is hidden while idle', async () => {
    asDesktop()
    const unmount = await mount(<UpdateCard />)
    expect(calls[0]?.path).toBe('/desktop/update')
    expect(document.body.textContent).toBe('')
    await unmount()
  })

  it('shows the version when ready', async () => {
    asDesktop()
    body = { state: 'ready', version: '1.2.3' }
    const unmount = await mount(<UpdateCard />)
    expect(document.body.textContent).toContain('Update ready')
    expect(document.body.textContent).toContain('Atlas 1.2.3 is ready to install')
    await unmount()
  })

  it('falls back when no version is known', async () => {
    asDesktop()
    body = { state: 'ready' }
    const unmount = await mount(<UpdateCard />)
    expect(document.body.textContent).toContain('A new version of Atlas is ready')
    await unmount()
  })

  it('posts restart and shows pending', async () => {
    asDesktop()
    body = { state: 'ready', version: '1.2.3' }
    const unmount = await mount(<UpdateCard />)
    await act(async () => button('Restart to update')?.click())
    expect(calls).toContainEqual({
      path: '/desktop/update/restart',
      method: 'POST',
    })
    expect(button('Restarting…')?.disabled).toBe(true)
    await unmount()
  })

  it('keeps restarting while the host reports restarting', async () => {
    asDesktop()
    body = { state: 'restarting', version: '1.2.3' }
    const unmount = await mount(<UpdateCard />)
    expect(button('Restarting…')?.disabled).toBe(true)
    await unmount()
  })

  it('shows a restart failure and lets you retry', async () => {
    asDesktop()
    body = { state: 'ready', version: '1.2.3', error: 'Cannot apply update: gone' }
    const unmount = await mount(<UpdateCard />)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Cannot apply update: gone')
    expect(button('Restart to update')?.disabled).toBe(false)
    await act(async () => button('Restart to update')?.click())
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(button('Restarting…')?.disabled).toBe(true)
    await unmount()
  })

  it('dismiss hides the card', async () => {
    asDesktop()
    body = { state: 'ready', version: '1.2.3' }
    const unmount = await mount(<UpdateCard />)
    await act(async () => button('Dismiss')?.click())
    expect(document.body.textContent).toBe('')
    await unmount()
  })
})
