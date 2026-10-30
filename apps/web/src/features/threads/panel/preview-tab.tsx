'use client'

import { GlobeIcon } from 'lucide-react'

import { PreviewFrame } from '@dltech/atlas-ui/ai/preview-frame'

import { usePreviewOrigins } from '@/features/desktop/use-preview-origins'

import type { usePreviews } from '../data/use-previews'
import { TabPlaceholder } from './tab-placeholder'

export function PreviewTab({ data }: { data: ReturnType<typeof usePreviews> }) {
  const { ports, selectedId, select } = data
  const framesAllowed = usePreviewOrigins(ports.map((port) => port.frameSrc ?? port.url))

  if (ports.length === 0) {
    return (
      <TabPlaceholder
        icon={<GlobeIcon />}
        title="Nothing to preview"
        description="Ports the sandbox exposes will show up here."
      />
    )
  }

  if (!framesAllowed) return null

  return <PreviewFrame ports={ports} selectedId={selectedId} onSelect={select} />
}
