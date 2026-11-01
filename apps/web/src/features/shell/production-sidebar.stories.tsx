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
import {
  archiveFixtureSessions,
  interactiveSessions,
  nestedSessions,
  observationCapSessions,
  project,
} from './production-sidebar-fixtures'
import { FixtureObservationControls } from './production-sidebar-observation-controls'
import { ThreadList } from './shell-thread-list'
import { ShellTopBar } from './shell-top-bar'
import { ThreadActionsContext } from './thread-actions-context'
import type { ProjectThreads } from './thread-partition'

function ProductionSidebar({
  desktopWidth = '18rem',
  nested = false,
  observationCap = false,
}: {
  desktopWidth?: string
  nested?: boolean
  observationCap?: boolean
}) {
  const fixtureSessions = observationCap
    ? observationCapSessions
    : nested
      ? nestedSessions
      : interactiveSessions
  const fixtureSource = useMemo(() => createFixtureSource(fixtureSessions), [fixtureSessions])
  const [checksFailed, setChecksFailed] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    observationCap ? 'observation-cap' : nested ? 'nested-leaf' : 'sidebar-main',
  )
  const [paneHidden, setPaneHidden] = useState(false)
  const [rowsMounted, setRowsMounted] = useState(true)
  const [archived, setArchived] = useState<string[]>([])
  const [searches, setSearches] = useState(0)
  const entries: ProjectThreads[] = [
    { project, sessions: archiveFixtureSessions({ sessions: fixtureSessions, archived }) },
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
            observationCap
              ? 'production-sidebar-observation-cap'
              : nested
                ? 'production-sidebar-nested-shared-branch-own2-middle3-leaf1'
                : 'production-sidebar-own2-mate3-mate1'
          }
          className="flex min-h-svh w-full bg-background"
        >
          <Sidebar collapsible="icon">
            <ShellTopBar onSearch={() => setSearches((count) => count + 1)} />
            <SidebarContent
              className={paneHidden ? 'hidden' : 'group-data-[collapsible=icon]:hidden'}
            >
              {rowsMounted ? (
                <ThreadList
                  entries={entries}
                  activeThreadId={activeThreadId}
                  subscribe={fixtureSource.subscribe}
                />
              ) : null}
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
              {observationCap
                ? 'This thread owns 140 PRs. Its visible row observes only the latest PR. Opening Details adds its rendered PR entries, bounded to 128 targets on the shared channel.'
                : nested
                  ? 'Recursive root → middle → leaf on the same repository and branch. Own PR counts: 2, 3, 1. A closed middle summarizes four; a closed root summarizes six. Neither may steal PR ownership from the shared live branch.'
                  : 'Real ThreadList, ThreadRow, ShellTopBar and hover cards. Fixtures are isolated to this story. Main owns two PRs; teammates own three and one. Collapse the family to verify six unique PRs.'}
            </p>
            <p className="text-sm">Selected: {activeThreadId ?? 'none'}</p>
            <p className="text-sm">Search activations: {searches}</p>
            <FixtureObservationControls
              source={fixtureSource}
              paneHidden={paneHidden}
              rowsMounted={rowsMounted}
              onTogglePane={() => setPaneHidden((current) => !current)}
              onToggleRows={() => setRowsMounted((current) => !current)}
            />
            <Button variant="outline" onClick={() => setActiveThreadId(null)}>
              Clear selection
            </Button>
          </main>
        </div>
      </SidebarProvider>
      <Toaster />
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
export const ObservationCap = { args: { desktopWidth: '18rem', observationCap: true } }
