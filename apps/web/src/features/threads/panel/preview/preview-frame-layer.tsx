'use client'

import { useCallback, useMemo, useRef } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { useIsDesktop } from '@/features/desktop/use-is-desktop'

import {
  updatePreviewBrowser,
  useAllPreviewBrowsers,
} from '../../data/preview-browser/use-preview-browser'
import { slotKeyOf, useFrameRegistry } from './frame-registry'
import { framesOf, type FrameSpec } from './frames-of'
import { CLIP_COUNT } from './native/clip'
import { isInSheet } from './native/masks'
import { webviewOf } from './native/native-controls'
import { NativeFrame } from './native/native-frame'
import { useNativeOverlaySync } from './native/overlay-sync'
import { reportedState } from './native/report-navigation'
import { useSlotTracking } from './placement'

const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'

function handleNavigated(args: { frame: FrameSpec; url: string }) {
  const { frame, url } = args
  updatePreviewBrowser({
    threadId: frame.threadId,
    change: ({ state }) => reportedState({ state, tabId: frame.tabId, url }),
  })
}

export function PreviewFrameLayer() {
  const desktop = useIsDesktop()
  const registry = useFrameRegistry()
  const states = useAllPreviewBrowsers()
  const frames = useMemo(() => framesOf({ states, registry }), [states, registry])
  const wrappers = useRef(new Map<string, HTMLDivElement>())
  const visibleKey = registry.visible === undefined ? undefined : slotKeyOf(registry.visible)
  const inSheet = isInSheet(registry.visible?.element)
  const frameOf = useCallback(
    () => (visibleKey === undefined ? undefined : wrappers.current.get(visibleKey)),
    [visibleKey],
  )
  useSlotTracking({ slot: registry.visible?.element, frameOf })
  const visibleWebview = useCallback(
    () => (visibleKey === undefined ? undefined : webviewOf(visibleKey)),
    [visibleKey],
  )
  const clipRef = useNativeOverlaySync({
    active: desktop,
    slot: registry.visible?.element,
    visibleKey,
    webviewOf: visibleWebview,
  })

  const clips = desktop
    ? Array.from({ length: CLIP_COUNT }, (_, at) => (
        <div
          key={`clip-${at}`}
          ref={clipRef(at)}
          data-preview-clip=""
          className="pointer-events-none fixed"
        />
      ))
    : []

  const frameNodes = frames.map((frame) => (
    <div
      key={frame.key}
      ref={(element) => {
        if (element !== null) wrappers.current.set(frame.key, element)
        return () => void wrappers.current.delete(frame.key)
      }}
      className={cn(
        'fixed top-0 left-0',
        frame.key !== visibleKey && 'invisible pointer-events-none',
      )}
    >
      {desktop ? (
        <NativeFrame
          frame={frame}
          visible={frame.key === visibleKey}
          inSheet={inSheet}
          onNavigated={handleNavigated}
        />
      ) : (
        <iframe
          key={`${frame.load.seq}:${registry.reloads[frame.key] ?? 0}`}
          src={frame.load.url}
          title="Preview"
          className="size-full border-0 bg-background"
          sandbox={FRAME_SANDBOX}
        />
      )}
    </div>
  ))

  return [...frameNodes, ...clips]
}
