import { describe, expect, it } from 'bun:test'

import type { WireThread } from '@dltech/atlas-wire/web'

import {
  EPullRequestState,
  EWorkKind,
  INACTIVE_AFTER_MS,
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
  { id: 'atlas', name: 'atlas' },
  { id: 'neo', name: 'comp-neo' },
  { id: 'rcp', name: 'RCP' },
]

describe('partitionSessions', () => {
  it('groups active sessions by project, most recently active project first', () => {
    const partition = partitionSessions({
      projects,
      now: NOW,
      threads: [
        threadOf({ id: 'a1', title: 'Older', updatedAt: hoursAgo(5) }),
        threadOf({ id: 'a2', title: 'Newer', updatedAt: hoursAgo(2) }),
        threadOf({ id: 'n1', projectId: 'neo', updatedAt: hoursAgo(1) }),
      ],
    })
    expect(partition.groups.map((group) => group.name)).toEqual(['comp-neo', 'atlas', 'RCP'])
    expect(partition.groups[1]?.sessions.map((session) => session.title)).toEqual([
      'Newer',
      'Older',
    ])
    expect(partition.groups[2]?.sessions).toEqual([])
  })

  it('moves stale sessions to inactive unless pinned, and archived ones to archived', () => {
    const stale = (INACTIVE_AFTER_MS + 3_600_000) / 3_600_000
    const partition = partitionSessions({
      projects,
      now: NOW,
      threads: [
        threadOf({ id: 'stale', updatedAt: hoursAgo(stale) }),
        threadOf({ id: 'pinned', updatedAt: hoursAgo(stale), pinnedAt: hoursAgo(200) }),
        threadOf({ id: 'gone', archivedAt: hoursAgo(1) }),
      ],
    })
    expect(partition.inactive.map((session) => session.id)).toEqual(['stale'])
    expect(partition.archived.map((session) => session.id)).toEqual(['gone'])
    expect(partition.groups[0]?.sessions.map((session) => session.id)).toEqual(['pinned'])
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

describe('sessionStatusOf', () => {
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

  it('ranks awaiting over working over pod state', () => {
    const of = (value: NonNullable<WireThread['status']>) =>
      sessionStatusOf(threadOf({ id: 't', status: value }))
    expect(of(status({ awaiting: 'input', working: true }))).toBe(ESessionStatus.Awaiting)
    expect(of(status({ working: true, podState: 'booting' }))).toBe(ESessionStatus.Running)
    expect(of(status({ podState: 'booting' }))).toBe(ESessionStatus.Starting)
    expect(of(status({ lastOutcome: 'failed' }))).toBe(ESessionStatus.Failed)
    expect(of(status({ podState: 'parked' }))).toBe(ESessionStatus.Parked)
    expect(of(status({}))).toBe(ESessionStatus.Idle)
    expect(sessionStatusOf(threadOf({ id: 'none' }))).toBe(ESessionStatus.Idle)
  })
})

describe('isUnread', () => {
  const at = (overrides: Partial<NonNullable<WireThread['status']>>) =>
    isUnread(
      threadOf({
        id: 't',
        status: {
          working: false,
          awaiting: null,
          lastOutcome: 'completed',
          podState: 'running',
          lastAssistantSeq: 5,
          readSeq: 3,
          ...overrides,
        },
      }),
    )

  it('is unread when the assistant spoke after the last read, unless still working', () => {
    expect(at({})).toBe(true)
    expect(at({ readSeq: 5 })).toBe(false)
    expect(at({ working: true })).toBe(false)
    expect(at({ working: true, awaiting: 'input' })).toBe(true)
    expect(at({ lastAssistantSeq: 0, readSeq: null })).toBe(false)
  })
})
