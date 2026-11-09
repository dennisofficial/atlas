import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { Tabs } from '@dltech/atlas-ui/components/tabs'

import { ERightTab } from '../right-tab'
import { RightTabStrip } from '../right-tab-strip'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
afterEach(() => {
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

const settle = () => act(async () => new Promise<void>((done) => setTimeout(done, 20)))

async function renderStrip(): Promise<string[]> {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () =>
    createRoot(host).render(
      <Tabs value={ERightTab.Preview}>
        <RightTabStrip counts={{}} />
      </Tabs>,
    ),
  )
  await settle()
  return [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('title') ?? '')
}

describe('RightTabStrip', () => {
  it('labels the right-hand pane Preview on web', async () => {
    expect(await renderStrip()).toContain('Preview')
  })

  it('labels the right-hand pane Browser on a host with a native browser', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false, nativeBrowser: true })
    const titles = await renderStrip()
    expect(titles).toContain('Browser')
    expect(titles).not.toContain('Preview')
  })

  it('keeps Preview when the host has no native browser', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    expect(await renderStrip()).toContain('Preview')
  })
})
