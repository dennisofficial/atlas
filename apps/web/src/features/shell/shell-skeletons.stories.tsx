import { useMemo, type CSSProperties } from 'react'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { createFixtureSource } from './production-sidebar-fixture-source'
import { interactiveSessions, project } from './production-sidebar-fixtures'
import { ShellSkeleton, ThreadsSkeleton } from './shell-skeletons'
import { ThreadList } from './shell-thread-list'
import { ThreadActionsContext } from './thread-actions-context'

const WIDTH = { '--sidebar-width': '18rem' } as CSSProperties
const actions = { onToggleArchive: () => {} }

function ThreadsPair() {
  const source = useMemo(() => createFixtureSource(interactiveSessions), [])
  return (
    <ThreadActionsContext.Provider value={actions}>
      <SidebarProvider style={WIDTH} className="min-h-0 items-start gap-8 p-6">
        <div className="w-72 bg-sidebar text-sidebar-foreground">
          <ThreadsSkeleton />
        </div>
        <div className="w-72 bg-sidebar text-sidebar-foreground">
          <ThreadList
            entries={[{ project, sessions: interactiveSessions.slice(0, 3) }]}
            activeThreadId={null}
            subscribe={source.subscribe}
          />
        </div>
      </SidebarProvider>
    </ThreadActionsContext.Provider>
  )
}

const meta = {
  title: 'App/Shell Skeletons',
  parameters: { layout: 'fullscreen', nextjs: { appDirectory: true } },
}

export default meta

export const Threads = { render: () => <ThreadsPair /> }
export const CheckingSession = { render: () => <ShellSkeleton /> }
