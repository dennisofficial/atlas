import { UsersIcon } from 'lucide-react'

import { TabPlaceholder } from './tab-placeholder'

export function AgentsTab() {
  return (
    <TabPlaceholder
      icon={<UsersIcon />}
      title="No agents yet"
      description="Sub-agents and teammates spawned by this thread will appear here."
    />
  )
}
