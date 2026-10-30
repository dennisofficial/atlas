import { describe, expect, it } from 'bun:test'

import { DESKTOP_PRELOAD } from '../preload'

const runPreload = () => {
  const listeners: Array<(event: { key: string; preventDefault: () => void }) => void> = []
  const fakeWindow = {
    addEventListener: (_type: string, listener: (typeof listeners)[number]) =>
      void listeners.push(listener),
  }
  new Function('window', DESKTOP_PRELOAD)(fakeWindow)
  return { fakeWindow, listeners }
}

const dispatch = (args: { listeners: ReturnType<typeof runPreload>['listeners']; key: string }) => {
  let prevented = false
  for (const listener of args.listeners)
    listener({ key: args.key, preventDefault: () => void (prevented = true) })
  return prevented
}

describe('DESKTOP_PRELOAD', () => {
  it('exposes the desktop bridge', () => {
    const { fakeWindow } = runPreload()
    expect(Reflect.get(fakeWindow, 'atlasDesktop')).toEqual({ vibrancy: false })
  })

  it('claims Escape so AppKit never exits full screen on it', () => {
    const { listeners } = runPreload()
    expect(dispatch({ listeners, key: 'Escape' })).toBe(true)
    expect(dispatch({ listeners, key: 'Enter' })).toBe(false)
  })
})
