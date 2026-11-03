import { describe, expect, it } from 'bun:test'

import type { WireThread } from '@dltech/atlas-wire/web'

import {
  EPullRequestState,
  EWorkKind,
  INACTIVE_AFTER_MS,
  NO_PROJECT_NAME,
  partitionSessions,
} from '../session-groups'
import { ESessionStatus, isUnread, sessionStatusOf } from '../session-status'

const NOW = Date.parse('2026-11-03T20:00:00.000Z')
const hoursAgo = (hours: number): string => new Date(NOW - hours * 3_600_000).toISOString()

const threadOf = (overrides: Partial<WireThread> & { id: string }): WireThread => ({
  head: 0,
  createdAt: hoursAgo(100),
  updatedAt: hoursAgo(1),
  workspace: null,
  repo: null,
  projectId: 'atlas',
  ...overrides,
})

const projects = [
  { id: 'neo', name: 'comp-neo', createdAt: hoursAgo(500) },
  { id: 'atlas', name: 'atlas', createdAt: hoursAgo(900) },
  { id: 'rcp', name: 'RCP', createdAt: hoursAgo(100) },
]

describe('partitionSessions', () => {
  it('orders projects by creation and sessions pinned-first then oldest-created first', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      threads: [
        threadOf({ id: 'late', createdAt: hoursAgo(5) }),
        threadOf({ id: 'early', createdAt: hoursAgo(50) }),
        threadOf({ id: 'pinned', createdAt: hoursAgo(2), pinnedAt: hoursAgo(1) }),
        threadOf({ id: 'neo', projectId: 'neo' }),
      ],
    })
    expect(partition.groups.map((group) => group.name)).toEqual(['atlas', 'comp-neo', 'RCP'])
    expect(partition.groups[0]?.sessions.map((session) => session.id)).toEqual([
      'pinned',
      'early',
      'late',
    ])
    expect(partition.groups[2]?.sessions).toEqual([])
  })

  it('shows a No project group only when it has sessions', () => {
    const empty = partitionSessions({ projects, now: NOW, threads: [] })
    expect(empty.groups.some((group) => group.projectId === null)).toBe(false)
    const loose = partitionSessions({
      projects,
      now: NOW,
      threads: [threadOf({ id: 'loose', projectId: null })],
    })
    expect(loose.groups.at(-1)).toMatchObject({ name: NO_PROJECT_NAME, projectId: null })
  })

  it('splits stale and archived sessions into per-project buckets', () => {
    const stale = (INACTIVE_AFTER_MS + 3_600_000) / 3_600_000
    const partition = partitionSessions({
      projects,
      now: NOW,
      threads: [
        threadOf({ id: 'stale', updatedAt: hoursAgo(stale) }),
        threadOf({ id: 'kept', updatedAt: hoursAgo(stale), pinnedAt: hoursAgo(200) }),
        threadOf({ id: 'gone', projectId: 'neo', archivedAt: hoursAgo(1) }),
      ],
    })
    expect(
      partition.inactive.map((group) => [group.name, group.sessions.map((s) => s.id)]),
    ).toEqual([['atlas', ['stale']]])
    expect(partition.archived.map((group) => group.name)).toEqual(['comp-neo'])
    expect(partition.groups[0]?.sessions.map((session) => session.id)).toEqual(['kept'])
  })

  it('drops sub-agent threads and threads of unknown projects', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      threads: [
        threadOf({ id: 'agent', agent: { spawnedBy: 'main', type: 'builder' } }),
        threadOf({ id: 'orphan', projectId: 'deleted' }),
      ],
    })
    expect(partition.groups.flatMap((group) => group.sessions)).toEqual([])
  })

  it('describes a session by its latest pull request, then its branch', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      threads: [
        threadOf({
          id: 'pr',
          pullRequests: [
            { number: 1700, url: '', repo: 'r', branch: 'a', state: 'OPEN' },
            { number: 1755, url: '', repo: 'r', branch: 'b', state: 'MERGED' },
          ],
        }),
        threadOf({ id: 'branch', worktree: { path: '/w', branch: 'dennis/expo' } }),
        threadOf({ id: 'bare', title: '' }),
      ],
    })
    const byId = new Map(partition.groups[0]?.sessions.map((session) => [session.id, session]))
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

describe('session status', () => {
  const status = (
    overrides: Partial<NonNullable<WireThread['status']>>,
  ): NonNullable<WireThread['status']> => ({
    working: false,
    awaiting: null,
    lastOutcome: null,
    podState: 'running',
    lastAssistantSeq: 0,
    readSeq: null,
    ...overrides,
  })
  const of = (value: NonNullable<WireThread['status']>) => threadOf({ id: 't', status: value })

  it('ranks awaiting over working over pod state', () => {
    expect(sessionStatusOf(of(status({ awaiting: 'input', working: true })))).toBe(
      ESessionStatus.Awaiting,
    )
    expect(sessionStatusOf(of(status({ working: true, podState: 'booting' })))).toBe(
      ESessionStatus.Running,
    )
    expect(sessionStatusOf(of(status({ podState: 'booting' })))).toBe(ESessionStatus.Starting)
    expect(sessionStatusOf(of(status({ lastOutcome: 'failed' })))).toBe(ESessionStatus.Failed)
    expect(sessionStatusOf(of(status({ podState: 'parked' })))).toBe(ESessionStatus.Parked)
    expect(sessionStatusOf(of(status({})))).toBe(ESessionStatus.Idle)
    expect(sessionStatusOf(threadOf({ id: 'none' }))).toBe(ESessionStatus.Idle)
  })

  it('is unread when the assistant spoke after the last read, unless still working', () => {
    const unread = (overrides: Partial<NonNullable<WireThread['status']>>) =>
      isUnread(of(status({ lastAssistantSeq: 5, readSeq: 3, ...overrides })))
    expect(unread({})).toBe(true)
    expect(unread({ readSeq: 5 })).toBe(false)
    expect(unread({ working: true })).toBe(false)
    expect(unread({ working: true, awaiting: 'input' })).toBe(true)
    expect(unread({ lastAssistantSeq: 0, readSeq: null })).toBe(false)
  })
})
