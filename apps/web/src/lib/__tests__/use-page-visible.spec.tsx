import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { usePageVisible } from '../use-page-visible'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('usePageVisible', () => {
  it('follows the document visibility as the tab hides and returns', async () => {
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    const seen: boolean[] = []

    function Probe() {
      seen.push(usePageVisible())
      return null
    }

    await act(async () => root.render(<Probe />))
    await act(async () => setVisibility('hidden'))
    await act(async () => setVisibility('visible'))

    expect(seen.at(0)).toBe(true)
    expect(seen).toContain(false)
    expect(seen.at(-1)).toBe(true)
    await act(async () => root.unmount())
  })
})
