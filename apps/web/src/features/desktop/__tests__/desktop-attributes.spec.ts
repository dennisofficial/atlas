import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { applyDesktopAttributes } from '../desktop-attributes'

beforeAll(() => GlobalRegistrator.register())
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let root: HTMLElement
beforeEach(() => {
  root = document.createElement('html')
})

describe('applyDesktopAttributes', () => {
  it('leaves the root untouched without the desktop bridge', () => {
    applyDesktopAttributes({ root, host: {} })
    expect(root.hasAttribute('data-desktop')).toBe(false)
    expect(root.hasAttribute('data-vibrancy')).toBe(false)
  })

  it('marks desktop without vibrancy', () => {
    applyDesktopAttributes({ root, host: { atlasDesktop: { vibrancy: false } } })
    expect(root.hasAttribute('data-desktop')).toBe(true)
    expect(root.hasAttribute('data-vibrancy')).toBe(false)
  })

  it('marks desktop and vibrancy', () => {
    applyDesktopAttributes({ root, host: { atlasDesktop: { vibrancy: true } } })
    expect(root.hasAttribute('data-desktop')).toBe(true)
    expect(root.hasAttribute('data-vibrancy')).toBe(true)
  })

  it('ignores a malformed bridge', () => {
    applyDesktopAttributes({ root, host: { atlasDesktop: 'yes' } })
    expect(root.hasAttribute('data-desktop')).toBe(false)
  })
})
