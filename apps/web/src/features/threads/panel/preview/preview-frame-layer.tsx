'use client'

import { useCallback, useMemo, useRef } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { useAllPreviewBrowsers } from '../../data/preview-browser/use-preview-browser'
import { slotKeyOf, useFrameRegistry } from './frame-registry'
import { framesOf } from './frames-of'
import { useSlotTracking } from './placement'
import { useAllowedFrames } from './use-allowed-frames'
import { useFrameReports } from './use-frame-reports'

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

export function PreviewFrameLayer() {
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
      <iframe
        key={frame.load.seq}
        ref={reportsFrom(frame)}
        src={frame.load.url}
        title="Preview"
        className="size-full border-0 bg-background"
        sandbox={FRAME_SANDBOX}
        allow={FRAME_ALLOW}
      />
    </div>
  ))
}
