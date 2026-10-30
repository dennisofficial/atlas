import { describe, expect, test } from 'bun:test'
import { fullscreenScript, syncFullscreen } from '../fullscreen'

describe('syncFullscreen', () => {
  test('pushes only on change and re-pushes after dom-ready', () => {
    let fs = false
    const scripts: string[] = []
    let resize: (e: unknown) => void = () => {}
    let ready: (e: unknown) => void = () => {}
    syncFullscreen({
      win: {
        isFullScreen: () => fs,
        on: (_n, h) => void (resize = h),
        webview: {
          executeJavascript: (js) => void scripts.push(js),
          on: (_n, h) => void (ready = h),
        },
      },
    })
    resize(null)
    resize(null)
    fs = true
    resize(null)
    ready(null)
    expect(scripts).toEqual([
      fullscreenScript(false),
      fullscreenScript(true),
      fullscreenScript(true),
    ])
  })
})
