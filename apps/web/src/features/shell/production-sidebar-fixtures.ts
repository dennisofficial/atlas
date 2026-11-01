import type { Project, WireSessionNode, WireThread } from '@dltech/atlas-wire/web'

const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
export const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()

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

export const interactiveSessions = [manager, ...scenarios.map((thread) => sessionOf(thread))]

export const SHARED_BRANCH = 'dennis/shared-sidebar-family'

function nestedThreadOf(args: {
  id: string
  title: string
  parentId?: string
  numbers: number[]
  status: NonNullable<WireThread['status']>
}): WireThread {
  return threadOf({
    id: args.id,
    title: args.title,
    parent: args.parentId ? { threadId: args.parentId, forkSeq: 2 } : undefined,
    agent: args.parentId ? { spawnedBy: args.parentId, type: 'teammate' } : undefined,
    worktree: { path: '/workspace/shared-sidebar-family', branch: SHARED_BRANCH },
    pullRequests: args.numbers.map((number) =>
      pullRequestOf({ number, branch: SHARED_BRANCH, state: number === 1606 ? 'merged' : 'open' }),
    ),
    status: args.status,
  })
}

export const nestedSessions = [
  sessionOf(
    nestedThreadOf({
      id: 'nested-root',
      title: 'Coordinate a shared-branch family',
      numbers: [1601, 1602],
      status: statusOf({ working: true }),
    }),
    [
      sessionOf(
        nestedThreadOf({
          id: 'nested-middle',
          title: 'Implement the nested sidebar slice',
          parentId: 'nested-root',
          numbers: [1603, 1604, 1605],
          status: statusOf({ awaiting: 'approval' }),
        }),
        [
          sessionOf(
            nestedThreadOf({
              id: 'nested-leaf',
              title: 'Verify the nested family behavior',
              parentId: 'nested-middle',
              numbers: [1606],
              status: statusOf({ lastOutcome: 'completed', readSeq: 8 }),
            }),
          ),
        ],
      ),
    ],
  ),
]

export const observationCapSessions = [
  sessionOf(
    threadOf({
      id: 'observation-cap',
      title: 'Bound visible observations to 128 targets',
      worktree: { path: '/workspace/observation-cap', branch: 'dennis/observation-cap' },
      pullRequests: Array.from({ length: 140 }, (_, index) =>
        pullRequestOf({ number: 2001 + index, branch: 'dennis/observation-cap' }),
      ),
    }),
  ),
]

export const project: Project = {
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

export function archiveFixtureSessions(args: {
  sessions: readonly WireSessionNode[]
  archived: readonly string[]
}): WireSessionNode[] {
  return args.sessions.map((session) => ({
    ...session,
    mainThread: {
      ...session.mainThread,
      archivedAt: args.archived.includes(session.mainThread.id) ? updatedAt : null,
    },
    teammates: archiveFixtureSessions({ sessions: session.teammates, archived: args.archived }),
  }))
}
