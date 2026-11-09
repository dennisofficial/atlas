import { useEffect, useRef } from 'react'

import { applyClips, CLIP_COUNT, clipRectsOf, STAGE_SELECTOR } from './clip'
import { createMaskSync, OVERLAY_SELECTORS, overlayStateOf } from './masks'
import type { NativeHandle } from './native-controls'

const rectOf = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return [left, top, width, height].map(Math.round)
}

export function useNativeOverlaySync(args: {
  active: boolean
  slot: HTMLElement | undefined
  visibleKey: string | undefined
  nativeOf: () => NativeHandle | undefined
}): (at: number) => (element: HTMLDivElement | null) => void {
  const { active, slot, visibleKey, nativeOf } = args
  const clips = useRef<Array<HTMLDivElement | null>>(Array.from({ length: CLIP_COUNT }, () => null))
  const latest = useRef(nativeOf)
  const overlay = useRef({ hidden: false })
  useEffect(() => {
    latest.current = nativeOf
  }, [nativeOf])

  useEffect(() => {
    if (!active || slot === undefined) return
    // Electrobun only re-reads mask rects when the webview itself moves, so overlays opening over a still page need a forced sync.
    // https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/preload/overlaySync.ts
    const observe = createMaskSync(() => {
      const native = latest.current()
      if (native === undefined) return
      native.driver.setObscured(overlay.current.hidden)
      native.webview.syncDimensions(true)
    })
    let handle = 0
    const handleFrame = () => {
      const stage = (slot.closest(STAGE_SELECTOR) ?? slot).getBoundingClientRect()
      const rects = clipRectsOf({
        stage,
        window: { width: window.innerWidth, height: window.innerHeight },
      })
      applyClips({ clips: clips.current.filter((clip) => clip !== null), rects })
      const state = overlayStateOf({ root: document, slot })
      overlay.current = { hidden: state.hidden }
      const popovers = [...document.querySelectorAll(OVERLAY_SELECTORS)].map(rectOf)
      observe(JSON.stringify([visibleKey, rects, popovers, state.hidden]))
      handle = requestAnimationFrame(handleFrame)
    }
    handleFrame()
    return () => cancelAnimationFrame(handle)
  }, [active, slot, visibleKey])

  return (at) => (element) => {
    clips.current[at] = element
  }
}
