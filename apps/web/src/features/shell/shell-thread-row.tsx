import { SidebarMenuItem } from '@dltech/atlas-ui/components/sidebar'
import type { SessionNode } from '@/features/threads/data/threads-api'

import { FolderToggle, TeammateList } from './shell-teammate-folder'
import { ThreadRowBody } from './shell-thread-row-body'
import { mainThreadsOf } from './thread-partition'
import { useFollowActive } from './use-follow-active'

export interface ThreadRowProps {
  session: SessionNode
  projectName: string
  activeThreadId: string | null
}

export function ThreadRow({ session, projectName, activeThreadId }: ThreadRowProps) {
  const teammates = mainThreadsOf(session.teammates)
  const holdsActive = teammates.some((teammate) => teammate.id === activeThreadId)
  const folder = useFollowActive(holdsActive)
  const thread = session.mainThread
  return (
    <SidebarMenuItem>
      <ThreadRowBody
        thread={thread}
        projectName={projectName}
        active={thread.id === activeThreadId}
        trailing={
          teammates.length > 0 ? (
            <FolderToggle open={folder.open} teammates={teammates} onToggle={folder.handleToggle} />
          ) : null
        }
      />
      {teammates.length > 0 && folder.open ? (
        <TeammateList teammates={teammates} activeThreadId={activeThreadId} />
      ) : null}
    </SidebarMenuItem>
  )
}
