import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from '@dltech/atlas-ui/components/sidebar'
import {
  EGithubPrStatesFrame,
  type GithubPrStatesFrame,
  type Project,
  type WireSessionNode,
  type WireThread,
} from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '@/features/threads/data/api-pr-states-source'

import { ThreadList } from './shell-thread-list'
import { ShellTopBar } from './shell-top-bar'
import { ThreadActionsContext } from './thread-actions-context'
import type { ProjectThreads } from './thread-partition'

const FIXTURE_ID = 'production-sidebar-own2-mate3-mate1'
const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()

const statusOf = (
  overrides: Partial<NonNullable<WireThread['status']>> = {},
): NonNullable<WireThread['status']> => ({
  working: false,
  awaiting: null,
  lastOutcome: null,
  podState: 'running',
  lastAssistantSeq: 8,
  readSeq: 6,
  ...overrides,
})

function threadOf(overrides: Partial<WireThread> & { id: string }): WireThread {
  return {
    head: 8,
    createdAt,
    updatedAt,
    workspace: '/workspace/atlas',
    repo: 'https://github.com/dltech/atlas',
    model: { ref: 'anthropic/claude-sonnet-4-6', effort: 'high' },
    status: statusOf(),
    ...overrides,
  }
}

function pullRequestOf(args: {
  number: number
  branch: string
  state?: string
}): NonNullable<WireThread['pullRequests']>[number] {
  return {
    ...args,
    state: args.state ?? 'open',
    title: `Production sidebar patch ${args.number}`,
    repo: 'dltech/atlas',
    url: `https://github.com/dltech/atlas/pull/${args.number}`,
  }
}

const sessionOf = (thread: WireThread, teammates: WireSessionNode[] = []): WireSessionNode => ({
  id: `session-${thread.id}`,
  mainThread: thread,
  teammates,
})

const manager = sessionOf(
  threadOf({
    id: 'sidebar-main',
    title: 'Ship the production sidebar',
    worktree: { path: '/workspace/sidebar', branch: 'dennis/sidebar-thread-rows' },
    pullRequests: [
      pullRequestOf({ number: 1481, branch: 'dennis/sidebar-thread-rows', state: 'merged' }),
      pullRequestOf({ number: 1488, branch: 'dennis/sidebar-thread-rows' }),
    ],
    status: statusOf({ working: true }),
    pinnedAt: createdAt,
  }),
  [
    sessionOf(
      threadOf({
        id: 'sidebar-data',
        title: 'Enrich PR checks and ownership',
        parent: { threadId: 'sidebar-main', forkSeq: 2 },
        agent: { spawnedBy: 'sidebar-main', type: 'teammate' },
        worktree: { path: '/workspace/data', branch: 'dennis/sidebar-data' },
        pullRequests: [1483, 1486, 1489].map((number) =>
          pullRequestOf({ number, branch: 'dennis/sidebar-data' }),
        ),
        status: statusOf({ awaiting: 'approval' }),
      }),
    ),
    sessionOf(
      threadOf({
        id: 'sidebar-tests',
        title: 'Cover accordion and density behavior',
        parent: { threadId: 'sidebar-main', forkSeq: 2 },
        agent: { spawnedBy: 'sidebar-main', type: 'teammate' },
        worktree: { path: '/workspace/tests', branch: 'dennis/sidebar-tests' },
        pullRequests: [
          pullRequestOf({ number: 1490, branch: 'dennis/sidebar-tests', state: 'merged' }),
        ],
        status: statusOf({ lastOutcome: 'completed', readSeq: 8 }),
      }),
    ),
  ],
)

const scenarios: WireThread[] = [
  threadOf({
    id: 'branch-only',
    title: 'Investigate session reconnects',
    worktree: { path: '/workspace/reconnect', branch: 'dennis/reconnect-after-wake' },
  }),
  threadOf({ id: 'unknown', title: 'No status or branch reported', status: undefined }),
  threadOf({
    id: 'starting',
    title: 'Starting a fresh pod',
    status: statusOf({ podState: 'booting' }),
  }),
  threadOf({
    id: 'input',
    title: 'Choose the database migration approach',
    status: statusOf({ awaiting: 'input' }),
  }),
  threadOf({
    id: 'failed',
    title: 'Repair the failing typecheck',
    status: statusOf({ lastOutcome: 'failed' }),
    pullRequests: [pullRequestOf({ number: 1484, branch: 'dennis/fix-types' })],
  }),
  threadOf({
    id: 'parked',
    title: 'Resume the parked workspace',
    status: statusOf({ podState: 'parked' }),
  }),
  threadOf({
    id: 'local',
    title: 'Review the Mac sidebar locally',
    runner: 'local',
    executionLocation: 'local',
    worktree: { path: '/Users/dennis/atlas', branch: 'dennis/mac-sidebar' },
  }),
  threadOf({
    id: 'draft',
    title: 'Explore a follow-up density refinement',
    pullRequests: [pullRequestOf({ number: 1487, branch: 'dennis/density', state: 'draft' })],
  }),
  threadOf({
    id: 'closed',
    title: 'Close the superseded navigation experiment',
    pullRequests: [
      pullRequestOf({ number: 1480, branch: 'dennis/old-navigation', state: 'closed' }),
    ],
  }),
]

const project: Project = {
  id: 'sidebar-atlas',
  name: 'atlas',
  repo: 'https://github.com/dltech/atlas',
  baseBranch: 'main',
  additionalRepos: [],
  description: 'Production sidebar verification',
  shipBehavior: 'open-pull-request' as Project['shipBehavior'],
  createdAt,
  updatedAt,
}

function createFixtureSource() {
  let failed = false
  const listeners = new Set<(frame: GithubPrStatesFrame) => void>()
  const frames = (): GithubPrStatesFrame[] =>
    [manager.mainThread, ...manager.teammates.map((mate) => mate.mainThread), ...scenarios].flatMap(
      (thread) =>
        (thread.pullRequests ?? []).map((pr) => ({
          type: EGithubPrStatesFrame.PrState,
          state: {
            repoFullName: pr.repo,
            prNumber: pr.number,
            title: pr.title ?? '',
            url: pr.url,
            state: pr.state ?? 'open',
            headBranch: pr.branch,
            headSha: 'storybook-fixture',
            checksRunning: pr.number === 1488 && !failed ? 1 : 0,
            checksPassed: pr.number === 1488 ? 3 : 4,
            checksFailed: (pr.number === 1488 && failed) || pr.number === 1489 ? 1 : 0,
            mergeable: pr.number !== 1489,
            updatedAt,
          },
        })),
    )
  const subscribe: ApiPrStatesSubscribe = ({ onData }) => {
    listeners.add(onData)
    for (const frame of frames()) onData(frame)
    return {
      unsubscribe: () => {
        listeners.delete(onData)
      },
    }
  }
  return {
    subscribe,
    toggle: () => {
      failed = !failed
      for (const listener of listeners) for (const frame of frames()) listener(frame)
      return failed
    },
  }
}

function ProductionSidebar({ desktopWidth = '18rem' }: { desktopWidth?: string }) {
  const fixtureSource = useMemo(createFixtureSource, [])
  const [checksFailed, setChecksFailed] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>('sidebar-main')
  const [archived, setArchived] = useState<string[]>([])
  const [searches, setSearches] = useState(0)
  const sessions = [manager, ...scenarios.map((thread) => sessionOf(thread))].map((session) => ({
    ...session,
    mainThread: {
      ...session.mainThread,
      archivedAt: archived.includes(session.mainThread.id) ? updatedAt : null,
    },
  }))
  const entries: ProjectThreads[] = [{ project, sessions }]
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
        <div data-fixture={FIXTURE_ID} className="flex min-h-svh w-full bg-background">
          <Sidebar collapsible="icon">
            <ShellTopBar onSearch={() => setSearches((count) => count + 1)} />
            <SidebarContent className="group-data-[collapsible=icon]:hidden">
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
              Real ThreadList, ThreadRow, ShellTopBar and hover cards. Fixtures are isolated to this
              story. Main owns two PRs; teammates own three and one. Collapse the family to verify
              six unique PRs.
            </p>
            <p className="text-sm">Selected: {activeThreadId ?? 'none'}</p>
            <p className="text-sm">Search activations: {searches}</p>
            <Button variant="outline" onClick={() => setActiveThreadId(null)}>
              Clear selection
            </Button>
          </main>
        </div>
      </SidebarProvider>
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
