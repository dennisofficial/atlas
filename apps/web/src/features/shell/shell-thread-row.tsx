import { SidebarMenuItem } from '@dltech/atlas-ui/components/sidebar'
import type { WireThread } from '@dltech/atlas-wire/web'

import { TeammateList } from './shell-teammate-folder'
import { ThreadFamilyProvider } from './shell-thread-family'
import { ThreadRowBody } from './shell-thread-row-body'
import { mainThreadsOf, type SessionNode, type ShellSessionNode } from './thread-partition'

export interface ThreadRowProps {
  session: ShellSessionNode
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
  return (
    <>
      <ThreadRowBody
        thread={thread}
        projectName={projectName}
        active={thread.id === activeThreadId}
        parent={parent}
        teammates={teammates}
        view={session.view}
        listedNaming={session.naming ?? false}
        teammateParents={teammateParentsOf(session)}
        collapsed={teammates.length === 0}
      />
      {teammates.length > 0 ? (
        <div className="group-data-[collapsible=icon]:hidden">
          <TeammateList
            sessions={session.teammates}
            parent={thread}
            projectName={projectName}
            activeThreadId={activeThreadId}
          />
        </div>
      ) : null}
    </>
  )
}
