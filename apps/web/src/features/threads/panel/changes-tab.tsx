import { GitCompareIcon } from 'lucide-react'

import { TabPlaceholder } from './tab-placeholder'

export function ChangesTab() {
  return (
    <TabPlaceholder
      icon={<GitCompareIcon />}
      title="No changes to show"
      description="Files this thread edits will appear here with their diffs."
    />
  )
}
