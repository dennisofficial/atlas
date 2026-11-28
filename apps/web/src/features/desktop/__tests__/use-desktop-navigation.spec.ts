import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { DESKTOP_NAVIGATE_EVENT } from '@dltech/atlas-wire/web'

import { desktopPathOf, watchDesktopNavigation } from '../use-desktop-navigation'

beforeAll(() => registerDom())
afterAll(async () => unregisterDom())

const navigate = (detail: unknown) => new CustomEvent(DESKTOP_NAVIGATE_EVENT, { detail })

describe('desktopPathOf', () => {
  it('reads an in-app path', () => {
    expect(desktopPathOf(navigate('/settings'))).toBe('/settings')
  })

  it('ignores anything else', () => {
    expect(desktopPathOf(navigate('//evil.example'))).toBeNull()
    expect(desktopPathOf(navigate('https://evil.example'))).toBeNull()
    expect(desktopPathOf(navigate(5))).toBeNull()
    expect(desktopPathOf(new Event(DESKTOP_NAVIGATE_EVENT))).toBeNull()
  })
})

const bridgeOf = () => {
  const listeners = new Set<(path: unknown) => boolean>()
  return {
    listeners,
    host: {
      atlasDesktop: {
        onNavigate: (listener: (path: unknown) => boolean) => listeners.add(listener),
        offNavigate: (listener: (path: unknown) => boolean) => listeners.delete(listener),
      },
    },
    emit: (path: unknown) => [...listeners].map((listener) => listener(path)),
  }
}

describe('watchDesktopNavigation', () => {
  it('accepts in-app paths through the router without changing the document', () => {
    const bridge = bridgeOf()
    const paths: string[] = []
    const unwatch = watchDesktopNavigation({
      host: bridge.host,
      navigate: (path) => paths.push(path),
    })

    expect(bridge.emit('/sessions/s?thread=main')).toEqual([true])
    expect(paths).toEqual(['/sessions/s?thread=main'])
    unwatch()
    expect(bridge.listeners.size).toBe(0)
    expect(bridge.emit('/settings')).toEqual([])
    expect(paths).toHaveLength(1)
  })

  it('rejects paths outside the app without acknowledging them', () => {
    const bridge = bridgeOf()
    const paths: string[] = []
    const unwatch = watchDesktopNavigation({
      host: bridge.host,
      navigate: (path) => paths.push(path),
    })

    for (const path of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      5,
    ]) {
      expect(bridge.emit(path)).toEqual([false])
    }
    expect(paths).toEqual([])
    unwatch()
  })

  it('does not claim navigation when no preload subscription is available', () => {
    for (const host of [
      {},
      { atlasDesktop: {} },
      { atlasDesktop: { onNavigate: () => undefined } },
    ]) {
      expect(() => watchDesktopNavigation({ host, navigate: () => undefined })()).not.toThrow()
    }
  })
})
