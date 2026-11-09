'use client'

import { useEffect, useRef, useState } from 'react'

import type { BrowserRenderer } from '@/features/desktop/use-browser-renderer'

import type { FrameSpec } from '../frames-of'
import { bindWebview } from './bind-webview'
import { createFrameDriver, type FrameDriver } from './frame-driver'
import { OVERLAY_MASKS } from './masks'
import { registerNative } from './native-controls'
import { forgetNativeStats, noteNativeEvent } from './native-stats'
import { isNativeWebview } from './webview-handle'

const CEF_PARTITION = 'persist:atlas-browser'

// Electrobun's WKWebView only takes a named store after `persist:` when it is a UUID, and otherwise silently drops to the app's default store.
// https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/native/macos/nativeWrapper.mm#L743-L767
const NATIVE_PARTITION = 'persist:A7C4B1E2-9F3D-4C6A-8B2E-5D1F0A9C3E7B'

export function partitionFor(renderer: BrowserRenderer): string {
  return renderer === 'cef' ? CEF_PARTITION : NATIVE_PARTITION
}

// Electrobun injects an unlayered `electrobun-webview { width: 800px; height: 300px }` that beats layered Tailwind utilities, so the size must be inline.
// https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/preload/webviewTag.ts#L476-L485
const FILL = { display: 'block', width: '100%', height: '100%' } as const

export function NativeFrame(props: {
  frame: FrameSpec
  renderer: BrowserRenderer
  visible: boolean
  onNavigated: (args: { frame: FrameSpec; url: string }) => void
}) {
  const { frame, renderer, visible, onNavigated } = props
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [initialUrl] = useState(frame.load.url)
  const driver = useRef<FrameDriver | undefined>(undefined)
  const latest = useRef({ frame, onNavigated })

  useEffect(() => {
    latest.current = { frame, onNavigated }
  }, [frame, onNavigated])

  useEffect(() => {
    if (!isNativeWebview(element)) return
    const { key, load } = latest.current.frame
    const held = createFrameDriver({ webview: element, seq: load.seq })
    driver.current = held
    const unregister = registerNative({ key, handle: { webview: element, driver: held } })
    const unbind = bindWebview({
      webview: element,
      onNavigated: (url) => latest.current.onNavigated({ frame: latest.current.frame, url }),
      onReady: held.reassertVisibility,
      onEvent: (event, url) => noteNativeEvent({ key, event, url }),
    })
    return () => {
      unbind()
      unregister()
      forgetNativeStats(key)
      driver.current = undefined
    }
  }, [element])

  useEffect(() => {
    driver.current?.apply({ url: frame.load.url, seq: frame.load.seq, visible })
  }, [element, frame.load.url, frame.load.seq, visible])

  return (
    <electrobun-webview
      ref={setElement}
      src={initialUrl}
      partition={partitionFor(renderer)}
      renderer={renderer}
      masks={OVERLAY_MASKS}
      style={FILL}
    />
  )
}
