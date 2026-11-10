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

  it('renders a context code file with a line per line and numbered gutters', async () => {
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <ContextFileBody
          path="artifacts/vuln-scorecard.ts"
          loaded={{
            state: 'ready',
            file: { type: 'text', content: 'const a = 1\nreturn a\n', truncated: false },
          }}
        />,
      ),
    )
    expect(host.querySelectorAll('[data-line]').length).toBe(2)
    expect(host.textContent).toContain('const a = 1')
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Contents of artifacts/vuln-scorecard.ts',
    )
    await act(async () => root.unmount())
  })

  it('offers a binary file as a download instead of a blank pane', async () => {
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <ContextFileBody
          path="artifacts/workflows-design-pack.zip"
          loaded={{
            state: 'ready',
            file: { type: 'binary', data: 'aGVsbG8=', bytes: 5 },
          }}
        />,
      ),
    )
    expect(host.textContent).toContain('Binary file · 5 B')
    expect(host.querySelector('button')?.textContent).toContain('Download')
    await act(async () => root.unmount())
  })
})
