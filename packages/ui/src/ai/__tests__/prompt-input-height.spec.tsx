import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { PromptInput } from '../prompt-input'

const FULL_SCREEN_CAP = 'max-h-[max(6rem,calc(100lvh/3))]'

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

const openKeyboard = (height: number) => {
  const viewport = new EventTarget()
  Object.defineProperty(viewport, 'height', { value: height, configurable: true })
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  viewport.dispatchEvent(new Event('resize'))
  window.dispatchEvent(new Event('resize'))
}

describe('composer height cap', () => {
  it('caps the field at a third of the full screen height, never below six rem', () => {
    const field = renderToStaticMarkup(<PromptInput />).match(/<textarea[^>]*>/)?.[0] ?? ''

    expect(field).toContain('overflow-y-auto')
    expect(field).toContain(FULL_SCREEN_CAP)
  })

  it('keeps the same cap when the keyboard shrinks the visible viewport', async () => {
    const { area, unmount } = await mountField()

    await act(async () => openKeyboard(480))

    expect(area.className).toContain(FULL_SCREEN_CAP)
    expect(area.style.maxHeight).toBe('')
    await unmount()
  })
})
