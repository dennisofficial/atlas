'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { previewOriginsOf } from '@/features/desktop/preview-origins'
import { useIsDesktop } from '@/features/desktop/use-is-desktop'
import { EPreviewGate, usePreviewOrigins } from '@/features/desktop/use-preview-origins'

import { useAllPreviewBrowsers } from '../../data/preview-browser/use-preview-browser'
import { changeRegistry, slotKeyOf, useFrameRegistry, withGate } from './frame-registry'
import { framesOf, type FrameSpec } from './frames-of'
import { useSlotTracking } from './placement'

const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'

function useAllowedFrames(frames: FrameSpec[]): (url: string) => boolean {
  const desktop = useIsDesktop()
  const urls = useMemo(() => frames.map((frame) => frame.url), [frames])
  const gate = usePreviewOrigins(urls)
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    changeRegistry((registry) => withGate({ registry, gate }))
    if (gate !== EPreviewGate.Ready) return
    setAllowed((held) => {
      const origins = previewOriginsOf(urls)
      return origins.every((origin) => held.has(origin)) ? held : new Set([...held, ...origins])
    })
  }, [gate, urls])
  return (url) => !desktop || previewOriginsOf([url]).every((origin) => allowed.has(origin))
}

export function PreviewFrameLayer() {
  const registry = useFrameRegistry()
  const states = useAllPreviewBrowsers()
  const frames = useMemo(() => framesOf({ states, registry }), [states, registry])
  const isAllowed = useAllowedFrames(frames)
  const wrappers = useRef(new Map<string, HTMLDivElement>())
  const visibleKey = registry.visible === undefined ? undefined : slotKeyOf(registry.visible)
  const frameOf = useCallback(
    () => (visibleKey === undefined ? undefined : wrappers.current.get(visibleKey)),
    [visibleKey],
  )
  useSlotTracking({ slot: registry.visible?.element, frameOf })

  return frames
    .filter((frame) => isAllowed(frame.url))
    .map((frame) => (
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
        <iframe
          key={registry.reloads[frame.key] ?? 0}
          src={frame.url}
          title="Preview"
          className="size-full border-0 bg-background"
          sandbox={FRAME_SANDBOX}
        />
      </div>
    ))
}
