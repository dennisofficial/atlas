import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import {
  applyDesktopAttributes,
  applyFullScreen,
  hasNativeBrowser,
  isDesktopHost,
  watchFullScreen,
} from '../desktop-attributes'

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

describe('applyFullScreen', () => {
  it('marks the root while the window is full screen', () => {
    applyFullScreen({ root, fullScreen: true })
    expect(root.hasAttribute('data-fullscreen')).toBe(true)
    applyFullScreen({ root, fullScreen: false })
    expect(root.hasAttribute('data-fullscreen')).toBe(false)
  })
})

describe('watchFullScreen', () => {
  const bridgeHost = (initial: boolean) => {
    const listeners = new Set<(fullScreen: boolean) => void>()
    return {
      listeners,
      host: {
        atlasDesktop: {
          fullScreen: () => initial,
          onFullScreenChange: (listener: (fullScreen: boolean) => void) => listeners.add(listener),
          offFullScreenChange: (listener: (fullScreen: boolean) => void) =>
            listeners.delete(listener),
        },
      },
    }
  }

  it('reports the host state and follows it until it is stopped', () => {
    const seen: boolean[] = []
    const { host, listeners } = bridgeHost(false)
    const stop = watchFullScreen({ host, onChange: (fullScreen) => seen.push(fullScreen) })
    expect(seen).toEqual([false])
    for (const listener of listeners) listener(true)
    expect(seen).toEqual([false, true])
    stop()
    expect(listeners.size).toBe(0)
  })

  it('starts from the host state when the app opens full screen', () => {
    const seen: boolean[] = []
    const { host } = bridgeHost(true)
    watchFullScreen({ host, onChange: (fullScreen) => seen.push(fullScreen) })
    expect(seen).toEqual([true])
  })

  it('does nothing for a host that does not report full screen', () => {
    const seen: boolean[] = []
    for (const host of [{}, { atlasDesktop: {} }, { atlasDesktop: { vibrancy: false } }]) {
      watchFullScreen({ host, onChange: (fullScreen) => seen.push(fullScreen) })()
    }
    expect(seen).toEqual([])
  })
})
