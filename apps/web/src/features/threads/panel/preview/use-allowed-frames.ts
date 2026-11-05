import { useEffect, useMemo, useState } from 'react'

import { previewOriginsOf } from '@/features/desktop/preview-origins'
import { useIsDesktop } from '@/features/desktop/use-is-desktop'
import { EPreviewGate, usePreviewOrigins } from '@/features/desktop/use-preview-origins'

import { changeRegistry, withGate } from './frame-registry'
import type { FrameSpec } from './frames-of'

export function useAllowedFrames(frames: FrameSpec[]): (frame: FrameSpec) => boolean {
  const desktop = useIsDesktop()
  const urls = useMemo(() => frames.map((frame) => frame.load.url), [frames])
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
  return (frame) =>
    !desktop || previewOriginsOf([frame.load.url]).every((origin) => allowed.has(origin))
}
