import { describe, expect, it } from 'bun:test'

import { ESessionStatus as CoreStatus } from '@dltech/atlas-core'
import { ESessionDisplay } from '@dltech/atlas-client/stream'
import { ESandboxStatus } from '@dltech/atlas-protocol'

import {
  EPullRequestState,
  EWorkKind,
  NO_PROJECT_NAME,
  partitionSessions,
  type V2SessionSummary,
} from '../session-groups'

const NOW = Date.parse('2026-11-03T20:00:00.000Z')
const hoursAgo = (hours: number): string => new Date(NOW - hours * 3_600_000).toISOString()

const projects = [
  { id: 'neo', name: 'comp-neo', createdAt: hoursAgo(500) },
  { id: 'atlas', name: 'atlas', createdAt: hoursAgo(900) },
  { id: 'rcp', name: 'RCP', createdAt: hoursAgo(100) },
]

const summaryOf = (
  overrides: Partial<V2SessionSummary> & { sessionId: string },
): V2SessionSummary => ({
  projectId: 'atlas',
  title: null,
  naming: false,
  mainThreadId: 'thr',
  model: { ref: 'anthropic/claude-opus-5-5', effort: 'high', fast: false },
  createdAt: hoursAgo(100),
  updatedAt: hoursAgo(1),
  archivedAt: null,
  ...overrides,
})

const entriesOf = (partition: ReturnType<typeof partitionSessions>) =>
  partition.groups.flatMap((group) => group.sessions)

describe('partitionSessions', () => {
  it('orders projects by creation and sessions oldest-created first', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [
        summaryOf({ sessionId: 'late', createdAt: hoursAgo(5) }),
        summaryOf({ sessionId: 'early', createdAt: hoursAgo(50) }),
        summaryOf({ sessionId: 'neo', projectId: 'neo' }),
      ],
    })
    expect(partition.groups.map((group) => group.name)).toEqual(['atlas', 'comp-neo'])
    expect(partition.groups[0]?.sessions.map((session) => session.id)).toEqual(['early', 'late'])
    expect(partition.groups[1]?.sessions.map((session) => session.id)).toEqual(['neo'])
  })

  it('hides a project with no activity and keeps one created inside 72h', () => {
    const partition = partitionSessions({
      projects: [...projects, { id: 'fresh', name: 'fresh', createdAt: hoursAgo(1) }],
      now: NOW,
      sessions: [],
    })
    expect(partition.groups.map((group) => group.name)).toEqual(['fresh'])
    expect(partition.groups[0]?.sessions).toEqual([])
  })

  it('keeps an old project while one of its sessions moved', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [summaryOf({ sessionId: 'moved', projectId: 'rcp' })],
    })
    expect(partition.groups.map((group) => group.name)).toEqual(['RCP'])
  })

  it('shows a No project group only when it has sessions', () => {
    const empty = partitionSessions({ projects, now: NOW, sessions: [] })
    expect(empty.groups.some((group) => group.projectId === null)).toBe(false)
    const loose = partitionSessions({
      projects,
      now: NOW,
      sessions: [summaryOf({ sessionId: 'loose', projectId: null })],
    })
    expect(loose.groups.at(-1)).toMatchObject({ name: NO_PROJECT_NAME, projectId: null })
  })

  it('files a session of a deleted project nowhere', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [summaryOf({ sessionId: 'gone', projectId: 'deleted' })],
    })
    expect(entriesOf(partition)).toEqual([])
  })

  it('marks a session unread until its read cursor reaches the last assistant seq', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [
        summaryOf({ sessionId: 'unread', lastAssistantSeq: 6, readSeq: 5 }),
        summaryOf({ sessionId: 'read', lastAssistantSeq: 6, readSeq: 6 }),
        summaryOf({
          sessionId: 'working',
          lastAssistantSeq: 6,
          status: { state: CoreStatus.Thinking },
        }),
      ],
    })
    const entries = entriesOf(partition)
    expect(entries.find((entry) => entry.id === 'unread')?.unread).toBe(true)
    expect(entries.find((entry) => entry.id === 'read')?.unread).toBe(false)
    expect(entries.find((entry) => entry.id === 'working')?.unread).toBe(false)
  })

  it('keeps a session that spawned itself as a peer at the top level', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [
        summaryOf({ sessionId: 'main' }),
        summaryOf({ sessionId: 'peer', spawnedBy: 'main', nested: false }),
      ],
    })
    expect(entriesOf(partition).map((entry) => entry.id)).toEqual(['main', 'peer'])
  })

  it('nests a teammate under the session that spawned it', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [
        summaryOf({ sessionId: 'main' }),
        summaryOf({ sessionId: 'mate', spawnedBy: 'main', nested: true }),
        summaryOf({ sessionId: 'helper', spawnedBy: 'mate', nested: true }),
      ],
    })
    const roots = entriesOf(partition)
    expect(roots.map((entry) => entry.id)).toEqual(['main'])
    expect(roots[0]?.children.map((entry) => entry.id)).toEqual(['mate'])
    expect(roots[0]?.children[0]?.children.map((entry) => entry.id)).toEqual(['helper'])
  })

  it('keeps a teammate whose spawner is archived or missing', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [
        summaryOf({ sessionId: 'archived-main', archivedAt: hoursAgo(2) }),
        summaryOf({ sessionId: 'mate', spawnedBy: 'archived-main', nested: true }),
        summaryOf({ sessionId: 'orphan', spawnedBy: 'vanished', nested: true }),
      ],
    })
    expect(entriesOf(partition).map((entry) => entry.id)).toEqual(['mate', 'orphan'])
    expect(partition.archived[0]?.sessions.map((entry) => entry.id)).toEqual(['archived-main'])
  })

  it('keeps an old session in its project and files archived sessions per project', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [
        summaryOf({ sessionId: 'stale', updatedAt: hoursAgo(100) }),
        summaryOf({ sessionId: 'kept' }),
        summaryOf({ sessionId: 'gone', projectId: 'neo', archivedAt: hoursAgo(1) }),
      ],
    })
    expect(partition.archived.map((group) => group.name)).toEqual(['comp-neo'])
    expect(partition.groups[0]?.sessions.map((session) => session.id)).toEqual(['stale', 'kept'])
  })

  it('describes a session by its latest pull request, then its branch', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      sessions: [
        summaryOf({
          sessionId: 'pr',
          pullRequest: {
            repo: 'dennisofficial/atlas',
            number: 1755,
            url: 'https://github.com/dennisofficial/atlas/pull/1755',
            state: 'merged',
            checks: null,
            mergeable: null,
          },
        }),
        summaryOf({ sessionId: 'branch', primaryBranch: 'dennis/expo' }),
        summaryOf({ sessionId: 'bare', title: '' }),
      ],
    })
    const byId = new Map(entriesOf(partition).map((entry) => [entry.id, entry]))
    expect(byId.get('pr')?.work).toEqual({
      kind: EWorkKind.PullRequest,
      number: 1755,
      state: EPullRequestState.Merged,
    })
    expect(byId.get('branch')?.work).toEqual({ kind: EWorkKind.Branch, branch: 'dennis/expo' })
    expect(byId.get('bare')?.work).toEqual({ kind: EWorkKind.Branch, branch: null })
    expect(byId.get('bare')?.title).toBe('Untitled')
  })
})

describe('session display', () => {
  const displayOf = (overrides: Partial<V2SessionSummary>) =>
    entriesOf(
      partitionSessions({
        projects,
        now: NOW,
        sessions: [summaryOf({ sessionId: 's', ...overrides })],
      }),
    )[0]?.status

  it('maps every session state to one display', () => {
    expect(displayOf({ status: { state: CoreStatus.Thinking } })).toBe(ESessionDisplay.Working)
    expect(displayOf({ status: { state: CoreStatus.WaitingForOperator } })).toBe(
      ESessionDisplay.WaitingForYou,
    )
    expect(displayOf({ status: { state: CoreStatus.SetupFailed } })).toBe(
      ESessionDisplay.StartFailed,
    )
    expect(displayOf({ status: { state: CoreStatus.Failed } })).toBe(ESessionDisplay.Failed)
    expect(displayOf({})).toBeUndefined()
  })

  it('lets the pod state override an idle session', () => {
    const idled = { status: { state: CoreStatus.Idle } }
    expect(
      displayOf({
        ...idled,
        sandbox: { status: ESandboxStatus.Sleeping, at: hoursAgo(1) },
      }),
    ).toBe(ESessionDisplay.Parked)
    expect(
      displayOf({
        ...idled,
        sandbox: { status: ESandboxStatus.Waking, at: hoursAgo(1) },
      }),
    ).toBe(ESessionDisplay.Starting)
    expect(
      displayOf({
        ...idled,
        sandbox: { status: ESandboxStatus.Failed, at: hoursAgo(1) },
      }),
    ).toBe(ESessionDisplay.Failed)
  })
})
