import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'

import { ERenderKind } from '../context-model'
import { FileBody } from '../file-viewer'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const renderInto = async (node: ReactNode) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, unmount: () => act(async () => root.unmount()) }
}

const loadedText = (content: string) =>
  ({ state: 'ready', file: { type: 'text', content, truncated: false } }) as const

describe('FileBody', () => {
  it('renders markdown as formatted content when asked to', async () => {
    const { host, unmount } = await renderInto(
      <FileBody
        path="docs/README.md"
        loaded={loadedText('# Title\n\nSome **bold** text')}
        marks={[]}
        rendered={ERenderKind.Markdown}
      />,
    )
    expect(host.querySelector('h1')?.textContent).toBe('Title')
    expect(host.textContent).toContain('Some bold text')
    expect(host.textContent).not.toContain('**')
    await unmount()
  })

  it('renders html in a sandboxed frame without same-origin access', async () => {
    const { host, unmount } = await renderInto(
      <FileBody
        path="site/index.html"
        loaded={loadedText('<h1>Hello</h1>')}
        marks={[]}
        rendered={ERenderKind.Html}
      />,
    )
    const frame = host.querySelector('iframe')
    expect(frame?.getAttribute('srcdoc')).toBe('<h1>Hello</h1>')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    await unmount()
  })
})
