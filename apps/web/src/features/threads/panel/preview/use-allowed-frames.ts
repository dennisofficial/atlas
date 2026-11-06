import { useEffect, useMemo, useState } from 'react'

import { previewOriginsOf } from '@/features/desktop/preview-origins'
import { useIsDesktop } from '@/features/desktop/use-is-desktop'
import { EPreviewGate, usePreviewOrigins } from '@/features/desktop/use-preview-origins'

import { changeRegistry, withGate } from './frame-registry'
import type { FrameSpec } from './frames-of'

export function allowedAfter(args: {
  held: ReadonlySet<string>
  gate: EPreviewGate
  urls: readonly string[]
}): ReadonlySet<string> {
  const { held, gate, urls } = args
  if (gate !== EPreviewGate.Ready) return held
  const confirmed = previewOriginsOf(urls)
  const unchanged = confirmed.length === held.size && confirmed.every((origin) => held.has(origin))
  return unchanged ? held : new Set(confirmed)
}

export function useAllowedFrames(frames: FrameSpec[]): (frame: FrameSpec) => boolean {
  const desktop = useIsDesktop()
  const urls = useMemo(() => frames.map((frame) => frame.load.url), [frames])
  const gate = usePreviewOrigins(urls)
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    changeRegistry((registry) => withGate({ registry, gate }))
    setAllowed((held) => allowedAfter({ held, gate, urls }))
  }, [gate, urls])
  return (frame) =>
    !desktop || previewOriginsOf([frame.load.url]).every((origin) => allowed.has(origin))
}
