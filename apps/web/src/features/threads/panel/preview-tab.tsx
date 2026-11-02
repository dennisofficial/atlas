'use client'

import { GlobeIcon } from 'lucide-react'

import { PreviewFrame } from '@dltech/atlas-ui/ai/preview-frame'

import { EPreviewGate, usePreviewOrigins } from '@/features/desktop/use-preview-origins'

import type { PreviewsState } from '../data/use-previews'
import { TabPlaceholder } from './tab-placeholder'

export function PreviewTab({ data }: { data: PreviewsState }) {
  const { ports, selectedId, src, select } = data
  const gate = usePreviewOrigins(ports.map((port) => port.frameSrc ?? port.url))

  if (ports.length === 0) {
    return (
      <TabPlaceholder
        icon={<GlobeIcon />}
        title="Nothing to preview"
        description="Ports the sandbox exposes will show up here."
      />
    )
  }

  if (gate === EPreviewGate.Waiting) return null

  if (gate === EPreviewGate.Failed) {
    return (
      <TabPlaceholder
        icon={<GlobeIcon />}
        title="Preview unavailable"
        description="The desktop app couldn't allow this preview's origin, so it can't be shown here. Reload the window to try again."
      />
    )
  }

  return <PreviewFrame ports={ports} selectedId={selectedId} onSelect={select} src={src} />
}
