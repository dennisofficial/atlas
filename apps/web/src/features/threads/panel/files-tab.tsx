import { FolderTreeIcon } from 'lucide-react'

import { TabPlaceholder } from './tab-placeholder'

export function FilesTab() {
  return (
    <TabPlaceholder
      icon={<FolderTreeIcon />}
      title="Files aren't available yet"
      description="Browse the thread's working directory here."
    />
  )
}
