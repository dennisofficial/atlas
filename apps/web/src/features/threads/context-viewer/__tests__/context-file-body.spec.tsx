import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ContextFileBody } from '../context-viewer'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('ContextFileBody', () => {
  it('renders a context image at its natural size, not a zero-width box', async () => {
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <ContextFileBody
          path="evidence/shot.png"
          loaded={{
            state: 'ready',
            file: { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' },
          }}
        />,
      ),
    )
    const image = host.querySelector('img')
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    expect(image?.getAttribute('width')).not.toBe('0')
    expect(image?.className).toContain('w-auto')
    await act(async () => root.unmount())
  })
})
