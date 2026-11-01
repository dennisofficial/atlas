import { useId, useState } from 'react'
import { SidebarMenuItem } from '@dltech/atlas-ui/components/sidebar'
import type { WireThread } from '@dltech/atlas-wire/web'
import type { SessionNode } from '@/features/threads/data/threads-api'

import { FolderToggle, TeammateList } from './shell-teammate-folder'
import { ThreadFamilyProvider } from './shell-thread-family'
import { ThreadRowBody } from './shell-thread-row-body'
import { mainThreadsOf } from './thread-partition'

export interface ThreadRowProps {
  session: SessionNode
  projectName: string
  activeThreadId: string | null
}

function teammateParentsOf(session: SessionNode): ReadonlyMap<string, WireThread> {
  const parents = new Map<string, WireThread>()
  const visit = (node: SessionNode) => {
    for (const child of node.teammates) {
      parents.set(child.mainThread.id, node.mainThread)
      visit(child)
    }
  }
  visit(session)
  return parents
}

export function ThreadRow(props: ThreadRowProps) {
  return (
    <ThreadFamilyProvider threads={mainThreadsOf([props.session])}>
      <SidebarMenuItem>
        <ThreadNodeRow {...props} />
      </SidebarMenuItem>
    </ThreadFamilyProvider>
  )
}

export function ThreadNodeRow({
  session,
  projectName,
  activeThreadId,
  parent,
}: ThreadRowProps & { parent?: WireThread | undefined }) {
  const teammates = mainThreadsOf(session.teammates)
  const thread = session.mainThread
  const familyActiveId =
    thread.id === activeThreadId || teammates.some((teammate) => teammate.id === activeThreadId)
      ? activeThreadId
      : null
  const [seenActiveId, setSeenActiveId] = useState(familyActiveId)
  const [open, setOpen] = useState(familyActiveId !== null)
  const childrenId = useId()
  if (seenActiveId !== familyActiveId) {
    setSeenActiveId(familyActiveId)
    setOpen(familyActiveId !== null)
  }
  const handleToggle = () => setOpen((current) => !current)
  const handleSelect = () => setOpen(true)
  return (
    <>
      <ThreadRowBody
        thread={thread}
        projectName={projectName}
        active={thread.id === activeThreadId}
        parent={parent}
        onSelect={handleSelect}
        teammates={teammates}
        teammateParents={teammateParentsOf(session)}
        collapsed={teammates.length === 0 || !open}
        trailing={
          teammates.length > 0 ? (
            <FolderToggle
              open={open}
              teammates={teammates}
              controls={childrenId}
              onToggle={handleToggle}
            />
          ) : null
        }
      />
      {teammates.length > 0 ? (
        <div id={childrenId} hidden={!open} className="group-data-[collapsible=icon]:hidden">
          {open ? (
            <TeammateList
              sessions={session.teammates}
              parent={thread}
              projectName={projectName}
              activeThreadId={activeThreadId}
            />
          ) : null}
        </div>
      ) : null}
    </>
  )
}
