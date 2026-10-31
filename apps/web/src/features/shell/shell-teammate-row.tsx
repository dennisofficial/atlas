import { SidebarMenuSubItem } from '@dltech/atlas-ui/components/sidebar'
import type { WireThread } from '@dltech/atlas-wire/web'

import { ThreadRowBody } from './shell-thread-row-body'

export interface TeammateRowProps {
  teammate: WireThread
  active: boolean
  parent: WireThread | undefined
  projectName: string
}

export function TeammateRow({ teammate, active, parent, projectName }: TeammateRowProps) {
  return (
    <SidebarMenuSubItem>
      <ThreadRowBody thread={teammate} active={active} parent={parent} projectName={projectName} />
    </SidebarMenuSubItem>
  )
}
