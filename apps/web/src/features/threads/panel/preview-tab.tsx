'use client'

import { GlobeIcon } from 'lucide-react'

import { PreviewFrame } from '@dltech/atlas-ui/ai/preview-frame'

import { usePreviews } from '../data/use-previews'
import { useThreadPanel } from './thread-panel-context'
import { TabPlaceholder } from './tab-placeholder'

export function PreviewTab() {
  const { channel } = useThreadPanel()
  const { ports, selectedId, select } = usePreviews(channel)

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
