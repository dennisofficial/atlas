import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { composerMaxHeight } from '../internal/use-visual-viewport-height'
import { PromptInput } from '../prompt-input'

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mountField = async () => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<PromptInput />))
  const area = container.querySelector('textarea')
  if (area === null) throw new Error('no textarea')
  return { area, unmount: () => act(async () => root.unmount()) }
}

const setViewportHeight = (height: number) => {
  const viewport = new EventTarget()
  Object.defineProperty(viewport, 'height', { value: height, configurable: true })
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  return viewport
}

describe('composer height cap', () => {
  it('caps the field at a third of the visible viewport', () => {
    expect(composerMaxHeight(932)).toBe(310)
    expect(composerMaxHeight(480)).toBe(160)
  })

  it('never caps below six rem', () => {
    expect(composerMaxHeight(200)).toBe(96)
  })

  it('scrolls inside the field with a static cap during server rendering', () => {
    const field = renderToStaticMarkup(<PromptInput />).match(/<textarea[^>]*>/)?.[0] ?? ''

    expect(field).toContain('overflow-y-auto')
    expect(field).toContain('max-h-[max(6rem,33svh)]')
  })

  it('follows the visual viewport when the keyboard opens', async () => {
    const viewport = setViewportHeight(932)
    const { area, unmount } = await mountField()
    expect(area.style.maxHeight).toBe('310px')

    setViewportHeight(480)
    await act(async () => viewport.dispatchEvent(new Event('resize')))

    expect(area.style.maxHeight).toBe('160px')
    await unmount()
  })
})
