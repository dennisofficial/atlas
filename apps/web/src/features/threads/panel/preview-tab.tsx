'use client'

import { GlobeIcon } from 'lucide-react'

import { PreviewFrame } from '@dltech/atlas-ui/ai/preview-frame'

import type { usePreviews } from '../data/use-previews'
import { TabPlaceholder } from './tab-placeholder'

export function PreviewTab({ data }: { data: ReturnType<typeof usePreviews> }) {
  const { ports, selectedId, select } = data

  if (ports.length === 0) {
    return (
      <TabPlaceholder
        icon={<GlobeIcon />}
        title="Nothing to preview"
        description="Ports the sandbox exposes will show up here."
      />
    )
  }

  return <PreviewFrame ports={ports} selectedId={selectedId} onSelect={select} />
}
