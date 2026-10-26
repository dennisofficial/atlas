import { SidebarMenuItem } from '@dltech/atlas-ui/components/sidebar'

import type { AppThread } from '../../fixtures/app'
import { teammatesOf } from '../../fixtures/teammates'
import { ThreadFolder } from './shell-thread-folder'
import { ThreadRowBody } from './shell-thread-row-body'

export interface ThreadRowProps {
  thread: AppThread
  activeThreadId?: string
  defaultCardOpen: boolean
}

export function ThreadRow({ thread, activeThreadId, defaultCardOpen }: ThreadRowProps) {
  const teammates = teammatesOf(thread.id)
  if (teammates.length > 0) {
    return (
      <ThreadFolder
        thread={thread}
        teammates={teammates}
        activeThreadId={activeThreadId}
        defaultCardOpen={defaultCardOpen}
      />
    )
  }
  return (
    <SidebarMenuItem>
      <ThreadRowBody
        thread={thread}
        active={thread.id === activeThreadId}
        defaultCardOpen={defaultCardOpen}
      />
    </SidebarMenuItem>
  )
}
