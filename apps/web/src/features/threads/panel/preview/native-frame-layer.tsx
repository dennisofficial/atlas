'use client'

import { useCallback, useMemo, useRef } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { useBrowserRenderer } from '@/features/desktop/use-browser-renderer'

import {
  updatePreviewBrowser,
  useAllPreviewBrowsers,
} from '../../data/preview-browser/use-preview-browser'
import { slotKeyOf, useFrameRegistry } from './frame-registry'
import { framesOf, type FrameSpec } from './frames-of'
import { CLIP_COUNT } from './native/clip'
import { nativeOf } from './native/native-controls'
import { NativeFrame } from './native/native-frame'
import { useNativeOverlaySync } from './native/overlay-sync'
import { useSlotTracking } from './placement'
import { reportedState } from './report-navigation'
import { usePreviewCallback } from './use-preview-callback'

function handleNavigated(args: { frame: FrameSpec; url: string }) {
  const { frame, url } = args
  updatePreviewBrowser({
    threadId: frame.threadId,
    change: ({ state }) => reportedState({ state, tabId: frame.tabId, url, title: '' }),
  })
}

export function NativeFrameLayer() {
  const registry = useFrameRegistry()
  const renderer = useBrowserRenderer()
  const states = useAllPreviewBrowsers()
  const frames = useMemo(() => framesOf({ states, registry }), [states, registry])
  const wrappers = useRef(new Map<string, HTMLDivElement>())
  const visibleKey = registry.visible === undefined ? undefined : slotKeyOf(registry.visible)
  const frameOf = useCallback(
    () => (visibleKey === undefined ? undefined : wrappers.current.get(visibleKey)),
    [visibleKey],
  )
  const visibleNative = useCallback(
    () => (visibleKey === undefined ? undefined : nativeOf(visibleKey)),
    [visibleKey],
  )
  useSlotTracking({ slot: registry.visible?.element, frameOf })
  usePreviewCallback(registry.visible)
  const clipRef = useNativeOverlaySync({
    active: visibleKey !== undefined,
    slot: registry.visible?.element,
    visibleKey,
    nativeOf: visibleNative,
  })

  if (renderer === null) return null

  return (
    <>
      {frames.map((frame) => (
        <div
          key={frame.key}
          ref={(element) => {
            if (element !== null) wrappers.current.set(frame.key, element)
            return () => void wrappers.current.delete(frame.key)
          }}
          inert={frame.key !== visibleKey}
          className={cn(
            'fixed top-0 left-0 overflow-hidden',
            frame.key !== visibleKey && 'invisible pointer-events-none',
          )}
        >
          <NativeFrame
            frame={frame}
            renderer={renderer}
            visible={frame.key === visibleKey}
            onNavigated={handleNavigated}
          />
        </div>
      ))}
      {Array.from({ length: CLIP_COUNT }, (_, at) => (
        <div
          key={`clip-${at}`}
          ref={clipRef(at)}
          data-preview-clip=""
          className="pointer-events-none fixed"
        />
      ))}
    </>
  )
}
