import { SidebarMenuSubItem } from '@dltech/atlas-ui/components/sidebar'
import type { WireThread } from '@dltech/atlas-wire/web'

import { ThreadNodeRow, type ThreadRowProps } from './shell-thread-row'

export function TeammateRow(props: ThreadRowProps & { parent: WireThread }) {
  return (
    <SidebarMenuSubItem>
      <ThreadNodeRow {...props} />
    </SidebarMenuSubItem>
  )
}
