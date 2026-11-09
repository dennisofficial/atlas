'use client'

import { useEffect, useRef, useState } from 'react'

import type { FrameSpec } from '../frames-of'
import { bindWebview } from './bind-webview'
import { createFrameDriver, type FrameDriver } from './frame-driver'
import { OVERLAY_MASKS } from './masks'
import { registerNative } from './native-controls'
import { isNativeWebview } from './webview-handle'

export const NATIVE_PARTITION = 'persist:atlas-browser'

// Electrobun injects an unlayered `electrobun-webview { width: 800px; height: 300px }` that beats layered Tailwind utilities, so the size must be inline.
// https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/preload/webviewTag.ts#L476-L485
const FILL = { display: 'block', width: '100%', height: '100%' } as const

export function NativeFrame(props: {
  frame: FrameSpec
  visible: boolean
  onNavigated: (args: { frame: FrameSpec; url: string }) => void
}) {
  const { frame, visible, onNavigated } = props
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
    })
    return () => {
      unbind()
      unregister()
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
      partition={NATIVE_PARTITION}
      masks={OVERLAY_MASKS}
      style={FILL}
    />
  )
}
