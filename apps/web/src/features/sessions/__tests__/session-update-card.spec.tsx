import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { SessionUpdateCard } from '../session-update-card'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'atlasDesktop')
})

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return () => act(async () => root.unmount())
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const button = () =>
  Array.from(document.body.querySelectorAll('button')).find(
    (element) => (element.textContent ?? '').length > 0,
  )

const answerWith = (body: unknown) => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as typeof fetch
}

beforeEach(() => {
  Reflect.deleteProperty(window, 'atlasDesktop')
})

describe('SessionUpdateCard on the web', () => {
  it('offers a reload instead of a dead end', async () => {
    await mount(<SessionUpdateCard />)
    expect(document.body.textContent).toContain('A newer Atlas wrote this session')
    expect(document.body.textContent).toContain('Reload to see everything in it.')
    expect(button()?.textContent).toBe('Reload')
  })
})

describe('SessionUpdateCard in the Mac app', () => {
  it('says no update has been released when the check finds none', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    answerWith({ state: 'idle' })
    await mount(<SessionUpdateCard />)
    await settle()
    expect(document.body.textContent).toContain('No update has been released yet')
    expect(button()?.textContent).toBe('Check again')
  })

  it('offers the restart once an update is downloaded', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    answerWith({ state: 'ready', version: '1.2.3' })
    await mount(<SessionUpdateCard />)
    await settle()
    expect(document.body.textContent).toContain('Restart to install 1.2.3.')
    expect(button()?.textContent).toBe('Restart to update')
  })

  it('reports a failed check rather than pretending to be current', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    await mount(<SessionUpdateCard />)
    await settle()
    expect(document.body.textContent).toContain('The update check failed.')
    expect(button()?.textContent).toBe('Try again')
  })
})
