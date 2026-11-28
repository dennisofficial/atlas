import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { DetailsMotion, Reveal, RevealRows } from '../details/reveal'

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  await unregisterDom()
})

describe('details reveal', () => {
  it('renders nothing when initially empty', () => {
    expect(renderToStaticMarkup(<Reveal open={false}>Empty</Reveal>)).toBe('')
  })
  it('shows content on the first paint', () => {
    expect(renderToStaticMarkup(<Reveal open>Content</Reveal>)).toContain('data-open="true"')
  })
  it('leaves horizontal clipping room for rounded row surfaces in rows and sections', () => {
    for (const section of [false, true]) {
      const html = renderToStaticMarkup(
        <Reveal open section={section}>
          Content
        </Reveal>,
      )
      expect(html).toContain('-mx-1.5 min-h-0 overflow-hidden px-1.5')
    }
  })
  it('reveals a mounted empty section when content arrives', async () => {
    await act(async () => root.render(<Reveal open={false}>Content</Reveal>))
    expect(container.textContent).toBe('')
    await act(async () => root.render(<Reveal open>Content</Reveal>))
    expect(container.textContent).toBe('Content')
  })
  it('updates rows without losing their local children', async () => {
    const rows = ['one']
    const render = (open: boolean) => (
      <RevealRows
        rows={rows}
        rowKey={(row) => row}
        render={() => <Reveal open={open}>Child</Reveal>}
      />
    )
    await act(async () => root.render(render(false)))
    await act(async () => root.render(render(true)))
    expect(container.textContent).toBe('Child')
  })

  it('retains exiting content until its height transition ends', async () => {
    const render = (open: boolean) => (
      <DetailsMotion>
        <Reveal open={open}>Retained</Reveal>
      </DetailsMotion>
    )
    await act(async () => root.render(render(true)))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)))
    await act(async () => root.render(render(false)))
    expect(container.textContent).toBe('Retained')
    expect(container.querySelector('[inert]')).not.toBeNull()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)))
    expect(container.textContent).toBe('')
  })

  it('can reopen before an exit finishes', async () => {
    const render = (open: boolean) => (
      <DetailsMotion>
        <Reveal open={open}>Restored</Reveal>
      </DetailsMotion>
    )
    await act(async () => root.render(render(true)))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)))
    await act(async () => root.render(render(false)))
    await act(async () => root.render(render(true)))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)))
    expect(container.textContent).toBe('Restored')
    expect(container.querySelector('[inert]')).toBeNull()
  })
})
