import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { applyDesktopAttributes, hasNativeBrowser, isDesktopHost } from '../desktop-attributes'

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

  it('marks a host with a native browser apart from a plain desktop one', () => {
    applyDesktopAttributes({
      root,
      host: { atlasDesktop: { vibrancy: false, nativeBrowser: true } },
    })
    expect(root.hasAttribute('data-native-browser')).toBe(true)
    expect(isDesktopHost({ atlasDesktop: { nativeBrowser: true } })).toBe(true)
    expect(hasNativeBrowser({ atlasDesktop: { nativeBrowser: true } })).toBe(true)
    expect(hasNativeBrowser({ atlasDesktop: { vibrancy: true } })).toBe(false)
    expect(hasNativeBrowser({})).toBe(false)
  })

  it('leaves the native browser attribute off a web host', () => {
    applyDesktopAttributes({ root, host: { atlasDesktop: { vibrancy: false } } })
    expect(root.hasAttribute('data-desktop')).toBe(true)
    expect(root.hasAttribute('data-native-browser')).toBe(false)
  })

  it('ignores a malformed bridge', () => {
    applyDesktopAttributes({ root, host: { atlasDesktop: 'yes' } })
    expect(root.hasAttribute('data-desktop')).toBe(false)
    expect(root.hasAttribute('data-native-browser')).toBe(false)
  })
})
