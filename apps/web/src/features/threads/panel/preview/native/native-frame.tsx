'use client'

import { useEffect, useRef, useState } from 'react'

import type { FrameSpec } from '../frames-of'
import { bindWebview } from './bind-webview'
import { createFrameDriver, type FrameDriver } from './frame-driver'
import { OVERLAY_MASKS, syncSheetMask } from './masks'
import { registerWebview, setNavState } from './native-controls'
import { isNativeWebview } from './webview-handle'

export const NATIVE_PARTITION = 'persist:atlas-preview'

export function NativeFrame(props: {
  frame: FrameSpec
  visible: boolean
  inSheet: boolean
  onNavigated: (args: { frame: FrameSpec; url: string }) => void
}) {
  const { frame, visible, inSheet, onNavigated } = props
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [initialUrl] = useState(frame.url)
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
    const unregister = registerWebview({ key, webview: element })
    const unbind = bindWebview({
      webview: element,
      onNavigated: (url) => latest.current.onNavigated({ frame: latest.current.frame, url }),
      onNavState: (state) => setNavState({ key, state }),
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

  useEffect(() => {
    if (isNativeWebview(element)) syncSheetMask({ webview: element, inSheet })
  }, [element, inSheet])

  return (
    <electrobun-webview
      ref={setElement}
      src={initialUrl}
      partition={NATIVE_PARTITION}
      masks={OVERLAY_MASKS}
      className="block size-full"
    />
  )
}
