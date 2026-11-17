import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from '@dltech/atlas-ui/components/sidebar'
import { Toaster } from '@dltech/atlas-ui/components/sonner'
import type { WireThread } from '@dltech/atlas-wire/web'

import { createFixtureSource } from './production-sidebar-fixture-source'
import { EAppNav } from './shell-types'
import {
  archiveFixtureSessions,
  interactiveSessions,
  nestedSessions,
  project,
} from './production-sidebar-fixtures'
import { MacWindowSimulation } from './production-sidebar-mac-window'
import { ThreadList } from './shell-thread-list'
import { ShellTopBar } from './shell-top-bar'
import { ThreadActionsContext } from './thread-actions-context'
import type { ProjectThreads } from './thread-partition'

function ProductionSidebar({
  desktopWidth = '18rem',
  nested = false,
  mac,
}: {
  desktopWidth?: string
  nested?: boolean
  mac?: { fullscreen: boolean }
}) {
  const fixtureSessions = nested ? nestedSessions : interactiveSessions
  const fixtureSource = useMemo(() => createFixtureSource(fixtureSessions), [fixtureSessions])
  const [checksFailed, setChecksFailed] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    nested ? 'nested-leaf' : 'sidebar-main',
  )
  const [archived, setArchived] = useState<string[]>(['sidebar-done'])
  const [searches, setSearches] = useState(0)
  const entries: ProjectThreads[] = [
    {
      project,
      sessions: archiveFixtureSessions({ sessions: fixtureSessions, archived }),
    },
  ]
  const handleNavigate = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a[href^="/threads/"]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    event.preventDefault()
    setActiveThreadId(decodeURIComponent(anchor.pathname.split('/').at(-1) ?? ''))
  }
  const handleArchive = (thread: WireThread) => {
    setArchived((current) =>
      current.includes(thread.id)
        ? current.filter((id) => id !== thread.id)
        : [...current, thread.id],
    )
  }
  return (
    <ThreadActionsContext.Provider value={{ onToggleArchive: handleArchive }}>
      <SidebarProvider
        style={{ '--sidebar-width': desktopWidth } as CSSProperties}
        onClickCapture={handleNavigate}
      >
        <div
          data-fixture={
            nested
              ? 'production-sidebar-nested-shared-branch-own2-middle3-leaf1'
              : 'production-sidebar-own2-mate3-mate1'
          }
          className="flex min-h-svh w-full bg-background"
        >
          <Sidebar collapsible="icon">
            <ShellTopBar nav={EAppNav.Threads} onSearch={() => setSearches((count) => count + 1)} />
            <SidebarContent>
              <ThreadList
                entries={entries}
                activeThreadId={activeThreadId}
                subscribe={fixtureSource.subscribe}
              />
            </SidebarContent>
            <SidebarFooter className="group-data-[collapsible=icon]:hidden">
              <Button variant="outline" onClick={() => setChecksFailed(fixtureSource.toggle())}>
                PR fixture: {checksFailed ? 'failing' : 'running'}
              </Button>
            </SidebarFooter>
          </Sidebar>
          <main className="flex min-w-0 flex-1 flex-col gap-4 p-8">
            <SidebarTrigger />
            <h1 className="text-xl font-semibold">Production sidebar</h1>
            <p className="max-w-lg text-sm text-muted-foreground">
              {nested
                ? 'Recursive root → middle → leaf on the same repository and branch, always expanded. Own PR counts: 2, 3, 1. Neither may steal PR ownership from the shared live branch.'
                : 'Real ThreadList, ThreadRow, ShellTopBar and hover cards. Fixtures are isolated to this story. Main owns two PRs; teammates stay expanded below it, and the done teammate sits behind the Done toggle. Mark a teammate row as done to watch it move into Done.'}
            </p>
            <p className="text-sm">Selected: {activeThreadId ?? 'none'}</p>
            <p className="text-sm">Search activations: {searches}</p>
            <Button variant="outline" onClick={() => setActiveThreadId(null)}>
              Clear selection
            </Button>
          </main>
        </div>
      </SidebarProvider>
      <Toaster />
      {mac ? <MacWindowSimulation fullscreen={mac.fullscreen} /> : null}
    </ThreadActionsContext.Provider>
  )
}

export default {
  title: 'App/Production Sidebar',
  component: ProductionSidebar,
  parameters: { layout: 'fullscreen', nextjs: { appDirectory: true } },
}

export const Interactive = { args: { desktopWidth: '18rem' } }
export const NarrowDefault256 = { args: { desktopWidth: '16rem' } }
export const NestedFamilies = { args: { desktopWidth: '18rem', nested: true } }
export const MacWindow = {
  args: { desktopWidth: '18rem', mac: { fullscreen: false } },
}
export const MacFullscreen = {
  args: { desktopWidth: '18rem', mac: { fullscreen: true } },
}
