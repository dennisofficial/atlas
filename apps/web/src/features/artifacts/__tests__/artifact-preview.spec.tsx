import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { ArtifactPreview, EPreviewMode } from '../artifact-preview'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
})

async function mount(mode: EPreviewMode) {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <ArtifactPreview
        url="https://ab12cd34ef56.byatlas.site"
        name="Docs"
        mode={mode}
        className="aspect-[16/10] w-full"
      />,
    ),
  )
}

const frame = () => document.querySelector('iframe')

describe('ArtifactPreview', () => {
  it('frames the artifact url in an iframe', async () => {
    await mount(EPreviewMode.Live)
    expect(frame()?.getAttribute('src')).toBe('https://ab12cd34ef56.byatlas.site')
    expect(frame()?.getAttribute('title')).toBe('Docs preview')
    expect(frame()?.getAttribute('loading')).toBe('lazy')
  })

  it('sandboxes the artifact away from the app', async () => {
    await mount(EPreviewMode.Live)
    const sandbox = frame()?.getAttribute('sandbox') ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-top-navigation')
  })

  it('makes a thumbnail inert and a live preview focusable', async () => {
    await mount(EPreviewMode.Thumbnail)
    expect(frame()?.className).toContain('pointer-events-none')
    expect(frame()?.getAttribute('aria-hidden')).toBe('true')

    await act(async () => root?.unmount())
    root = null
    container?.remove()
    container = null

    await mount(EPreviewMode.Live)
    expect(frame()?.className).toContain('size-full')
    expect(frame()?.getAttribute('aria-hidden')).toBeNull()
    expect(frame()?.getAttribute('tabindex')).toBe('0')
  })
})
