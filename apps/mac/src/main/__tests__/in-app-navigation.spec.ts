import { describe, expect, it } from 'bun:test'

import { DESKTOP_NAVIGATE_EVENT, DESKTOP_PREVIEW_CALLBACK_EVENT } from '@dltech/atlas-wire/web'

import { navigateScript, previewCallbackScript } from '../in-app-navigation'

describe('navigateScript', () => {
  it('dispatches the navigate event with the path', () => {
    const dispatched: { name: string; detail: unknown }[] = []
    const window = {
      dispatchEvent: (event: { type: string; detail: unknown }) =>
        void dispatched.push({ name: event.type, detail: event.detail }),
    }
    class CustomEvent {
      constructor(
        readonly type: string,
        readonly init: { detail: unknown },
      ) {}
      get detail() {
        return this.init.detail
      }
    }
    new Function('window', 'CustomEvent', navigateScript('/settings') ?? '')(window, CustomEvent)
    expect(dispatched).toEqual([{ name: DESKTOP_NAVIGATE_EVENT, detail: '/settings' }])
  })

  it('dispatches the preview callback event for a callback path', () => {
    expect(previewCallbackScript('/cb?code=c')).toBe(
      `window.dispatchEvent(new CustomEvent(${JSON.stringify(DESKTOP_PREVIEW_CALLBACK_EVENT)}, { detail: "/cb?code=c" }))`,
    )
    expect(previewCallbackScript('//evil.example')).toBeNull()
  })

  it('refuses anything that is not an in-app path', () => {
    expect(navigateScript('//evil.example/x')).toBeNull()
    expect(navigateScript('https://evil.example')).toBeNull()
    expect(navigateScript('/a\\b')).toBeNull()
  })
})
