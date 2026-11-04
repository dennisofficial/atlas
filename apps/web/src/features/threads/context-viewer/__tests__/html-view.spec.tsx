import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { HtmlFrame } from '../html-view'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('HtmlFrame', () => {
  it('runs agent html in a scripts-only sandbox with no access to the Atlas origin', async () => {
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<HtmlFrame html="<h1>Deck</h1>" title="deck.html" />))
    const frame = host.querySelector('iframe')
    expect(frame?.getAttribute('srcdoc')).toBe('<h1>Deck</h1>')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('title')).toBe('deck.html')
    await act(async () => root.unmount())
  })
})
