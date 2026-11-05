import { useEffect, useRef } from 'react'

import { applyClips, CLIP_COUNT, clipRectsOf, STAGE_SELECTOR } from './clip'
import { createMaskSync, OVERLAY_SELECTORS } from './masks'
import type { NativeWebview } from './webview-handle'

const rectOf = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return [left, top, width, height].map(Math.round)
}

export function useNativeOverlaySync(args: {
  active: boolean
  slot: HTMLElement | undefined
  visibleKey: string | undefined
  webviewOf: () => NativeWebview | undefined
}): (at: number) => (element: HTMLDivElement | null) => void {
  const { active, slot, visibleKey, webviewOf } = args
  const clips = useRef<Array<HTMLDivElement | null>>(Array.from({ length: CLIP_COUNT }, () => null))
  const latest = useRef(webviewOf)
  useEffect(() => {
    latest.current = webviewOf
  }, [webviewOf])

  useEffect(() => {
    if (!active || slot === undefined) return
    // Electrobun only re-reads mask rects when the webview itself moves, so menus opening over a still page need a forced sync.
    // https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/preload/overlaySync.ts
    const observe = createMaskSync(() => latest.current()?.syncDimensions(true))
    let handle = 0
    const handleFrame = () => {
      const stage = (slot.closest(STAGE_SELECTOR) ?? slot).getBoundingClientRect()
      const rects = clipRectsOf({
        stage,
        window: { width: window.innerWidth, height: window.innerHeight },
      })
      applyClips({ clips: clips.current.filter((clip) => clip !== null), rects })
      const overlays = [...document.querySelectorAll(OVERLAY_SELECTORS)].map(rectOf)
      observe(JSON.stringify([visibleKey, rects, overlays]))
      handle = requestAnimationFrame(handleFrame)
    }
    handleFrame()
    return () => cancelAnimationFrame(handle)
  }, [active, slot, visibleKey])

  return (at) => (element) => {
    clips.current[at] = element
  }
}
