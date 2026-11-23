import { useMemo, type CSSProperties } from 'react'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { createFixtureSource } from './production-sidebar-fixture-source'
import { interactiveSessions, project } from './production-sidebar-fixtures'
import { ShellSkeleton, ThreadsSkeleton } from './shell-skeletons'
import { SidebarVersionLines, SidebarVersionSkeletonLines } from './sidebar-version'
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

const WEB_LINES = ['Interface 1.179.4 · 5cc4b0e']
const MAC_LINES = ['App 1.179.4', 'Interface 1.179.4 · 5cc4b0e']

function VersionPair({ lines }: { lines: string[] }) {
  return (
    <div className="flex gap-8">
      <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
        <SidebarVersionSkeletonLines lines={lines} />
      </div>
      <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
        <SidebarVersionLines lines={lines} />
      </div>
    </div>
  )
}

function VersionLines() {
  return (
    <SidebarProvider style={WIDTH} className="min-h-0 flex-col items-start gap-8 p-6">
      <VersionPair lines={WEB_LINES} />
      <VersionPair lines={MAC_LINES} />
    </SidebarProvider>
  )
}

const meta = {
  title: 'App/Shell Skeletons',
  parameters: { layout: 'fullscreen', nextjs: { appDirectory: true } },
}

export default meta

export const Threads = { render: () => <ThreadsPair /> }
export const CheckingSession = { render: () => <ShellSkeleton /> }
export const Versions = { render: () => <VersionLines /> }
