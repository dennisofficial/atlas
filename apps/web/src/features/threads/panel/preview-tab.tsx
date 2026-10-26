import { GlobeIcon } from 'lucide-react'

import { TabPlaceholder } from './tab-placeholder'

export function PreviewTab() {
  return (
    <TabPlaceholder
      icon={<GlobeIcon />}
      title="Nothing to preview"
      description="Ports the sandbox exposes will show up here."
    />
  )
}
