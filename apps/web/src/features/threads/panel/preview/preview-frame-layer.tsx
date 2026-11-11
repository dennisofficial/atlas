'use client'

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { useHasNativeBrowser } from '@/features/desktop/use-has-native-browser'

import { useAllPreviewBrowsers } from '../../data/preview-browser/use-preview-browser'
import { EPaneMode, usePaneMode } from './desktop/use-pane-mode'
import { changeRegistry, slotKeyOf, useFrameRegistry, withLoading } from './frame-registry'
import { framesOf, type FrameSpec } from './frames-of'
import { NativeFrameLayer } from './native-frame-layer'
import { useSlotTracking } from './placement'
import { useAllowedFrames } from './use-allowed-frames'
import { useFrameReports } from './use-frame-reports'
import { usePreviewCallback } from './use-preview-callback'

const FRAME_SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
  'allow-storage-access-by-user-activation',
  'allow-pointer-lock',
  'allow-presentation',
].join(' ')

const FRAME_ALLOW = [
  'clipboard-read',
  'clipboard-write',
  'fullscreen',
  'camera',
  'microphone',
  'geolocation',
  'display-capture',
  'web-share',
].join('; ')

const markLoading = (args: { key: string; loading: boolean }) =>
  changeRegistry((registry) => withLoading({ registry, ...args }))

function PreviewFrame(props: {
  frame: FrameSpec
  reportsFrom: ReturnType<typeof useFrameReports>
}) {
  const { frame, reportsFrom } = props
  useLayoutEffect(() => {
    markLoading({ key: frame.key, loading: true })
    return () => markLoading({ key: frame.key, loading: false })
  }, [frame.key])
  return (
    <iframe
      ref={reportsFrom(frame)}
      src={frame.load.url}
      title="Preview"
      className="size-full border-0 bg-white"
      sandbox={FRAME_SANDBOX}
      allow={FRAME_ALLOW}
      onLoad={() => markLoading({ key: frame.key, loading: false })}
    />
  )
}

export function PreviewFrameLayer() {
  const native = useHasNativeBrowser()
  const pane = usePaneMode()
  // In the Mac shell the preview is a native view owned by the shell. Drawing frames over it would
  // put a second, empty browser underneath every preview tab.
  if (pane !== EPaneMode.InPage) return null
  return native ? <NativeFrameLayer /> : <IframeFrameLayer />
}

function IframeFrameLayer() {
  const registry = useFrameRegistry()
  const states = useAllPreviewBrowsers()
  const frames = useMemo(() => framesOf({ states, registry }), [states, registry])
  const isAllowed = useAllowedFrames(frames)
  const reportsFrom = useFrameReports()
  const wrappers = useRef(new Map<string, HTMLDivElement>())
  const visibleKey = registry.visible === undefined ? undefined : slotKeyOf(registry.visible)
  const frameOf = useCallback(
    () => (visibleKey === undefined ? undefined : wrappers.current.get(visibleKey)),
    [visibleKey],
  )
  useSlotTracking({ slot: registry.visible?.element, frameOf })
  usePreviewCallback(registry.visible)

  return frames.filter(isAllowed).map((frame) => (
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
      <PreviewFrame key={frame.load.seq} frame={frame} reportsFrom={reportsFrom} />
    </div>
  ))
}
