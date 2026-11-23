import { describe, expect, it } from 'bun:test'

import { ESessionDisplay } from '@dltech/atlas-client/stream'
import { ESessionStatus as CoreStatus } from '@dltech/atlas-core'

import {
  EPullRequestState,
  EWorkKind,
  INACTIVE_AFTER_MS,
  partitionSessions,
} from '../session-groups'
import { listV2Sessions, type V2SessionSummary } from '../v2-sessions'

const NOW = Date.parse('2026-11-09T12:00:00.000Z')
const hoursAgo = (hours: number): string => new Date(NOW - hours * 3_600_000).toISOString()

const projects = [{ id: 'atlas', name: 'atlas', createdAt: hoursAgo(900) }]

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

describe('listV2Sessions', () => {
  it('asks for the newest sessions and returns them', async () => {
    const asked: { limit: number }[] = []
    const sessions = await listV2Sessions({
      api: {
        sessions: {
          list: {
            query: async (input) => {
              asked.push(input)
              return { sessions: [summaryOf({ sessionId: 'ses_1' })] }
            },
          },
        },
      },
    })
    expect(sessions.map((session) => session.sessionId)).toEqual(['ses_1'])
    expect(asked).toEqual([{ limit: 100 }])
  })
})

describe('partitionSessions with v2 sessions', () => {
  it('files a v2 session under its project with its working display', () => {
    const partition = partitionSessions({
      projects,
      sessions: [
        summaryOf({
          sessionId: 'ses_1',
          title: 'Ship mobile v2',
          status: { state: CoreStatus.Thinking },
          primaryBranch: 'dennis/mobile-v2',
        }),
      ],
      now: NOW,
    })
    const entry = partition.groups[0]?.sessions[0]
    expect(entry).toMatchObject({
      id: 'ses_1',
      title: 'Ship mobile v2',
      status: ESessionDisplay.Working,
      work: { kind: EWorkKind.Branch, branch: 'dennis/mobile-v2' },
    })
  })

  it('files an archived session in the archived bucket and an old one as inactive', () => {
    const partition = partitionSessions({
      projects,
      sessions: [
        summaryOf({ sessionId: 'ses_old', updatedAt: hoursAgo(INACTIVE_AFTER_MS / 3_600_000 + 1) }),
        summaryOf({ sessionId: 'ses_archived', archivedAt: hoursAgo(2) }),
      ],
      now: NOW,
    })
    expect(partition.inactive[0]?.sessions.map((entry) => entry.id)).toEqual(['ses_old'])
    expect(partition.archived[0]?.sessions.map((entry) => entry.id)).toEqual(['ses_archived'])
  })

  it('names an untitled session and a pull request branch', () => {
    const partition = partitionSessions({
      projects,
      sessions: [
        summaryOf({
          sessionId: 'ses_2',
          status: { state: CoreStatus.Failed, reason: 'clone failed' },
          pullRequest: {
            repo: 'dennisofficial/atlas',
            number: 42,
            url: 'https://github.com/dennisofficial/atlas/pull/42',
            state: 'open',
            checks: null,
            mergeable: null,
          },
        }),
      ],
      now: NOW,
    })
    const entry = partition.groups[0]?.sessions[0]
    expect(entry?.title).toBe('Untitled')
    expect(entry?.status).toBe(ESessionDisplay.Failed)
    expect(entry?.work).toEqual({
      kind: EWorkKind.PullRequest,
      number: 42,
      state: EPullRequestState.Open,
    })
  })
})
